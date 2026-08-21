-- Corrige a regressão introduzida por 20260821151000_assignment_queue_online_only.sql:
-- nada no sistema jamais gravava app_users.is_online = true (achado do code
-- review de 21/08/2026), então o round-robin filtrado por is_online nunca
-- atribuía ninguém. Esta migration resolve em duas frentes:
--
--   1. Presença real: RPC set_own_presence(), chamada pelo frontend em
--      heartbeat, marca is_online + last_seen_at. "Online" para o round-robin
--      passa a exigir is_online = true E last_seen_at recente — assim uma aba
--      fechada sem disparar unload (crash, fechar o notebook) não fica
--      "online" pra sempre; o heartbeat para de bater e o presence expira.
--   2. Rede de segurança: se a busca filtrada por online não achar ninguém,
--      cai pro round-robin puro (ignora presença) em vez de retornar NULL —
--      uma conversa em handoff nunca fica sem responsável só porque a
--      presença ainda não está sendo reportada (ex.: logo após o deploy,
--      antes de qualquer usuário atualizar a sessão).
--
-- Também fecha um vetor de escalonamento de privilégio que a policy
-- app_users_self_presence_update (20260430120002_drop_multitenant.sql:550)
-- deixou aberto sem querer: por ser "FOR UPDATE ... USING (user_id =
-- auth.uid())" sem WITH CHECK por coluna, QUALQUER usuário autenticado já
-- podia, direto da tabela, fazer UPDATE app_users SET role = 'admin' WHERE
-- user_id = auth.uid() — client-side, sem passar por nenhuma Edge Function.
-- Isso já existe em produção hoje, independente desta rodada; o trigger de
-- guarda abaixo fecha o buraco em vez de só evitar usá-lo.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Considerado "online" só com heartbeat recente — evita presença travada em
-- true por uma aba que fechou sem avisar o servidor.
CREATE OR REPLACE FUNCTION whatsapp_hub._is_recently_online(p_is_online boolean, p_last_seen_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_is_online, false)
     AND p_last_seen_at IS NOT NULL
     AND p_last_seen_at > (now() - interval '2 minutes');
$$;

-- Guarda contra auto-promoção via a policy de presença (que só checa
-- user_id = auth.uid(), não quais colunas mudaram): quem não é admin só pode
-- alterar is_online/last_seen_at na própria linha; qualquer outra coluna
-- volta para o valor anterior, silenciosamente, em vez de falhar a query
-- inteira (uma UPDATE com múltiplos SETs de um cliente não-malicioso nunca
-- deveria mexer em role/department_id de qualquer forma).
CREATE OR REPLACE FUNCTION whatsapp_hub._app_users_guard_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  IF whatsapp_hub.current_user_role() NOT IN ('admin', 'super_admin') THEN
    NEW.role := OLD.role;
    NEW.department_id := OLD.department_id;
    NEW.user_id := OLD.user_id;
    NEW.accepted_at := OLD.accepted_at;
    NEW.invited_at := OLD.invited_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_users_guard_self_update ON whatsapp_hub.app_users;
CREATE TRIGGER trg_app_users_guard_self_update
  BEFORE UPDATE ON whatsapp_hub.app_users
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._app_users_guard_self_update();

-- RPC que o frontend chama em heartbeat — evita que o cliente precise saber
-- da policy de UPDATE direta na tabela.
CREATE OR REPLACE FUNCTION whatsapp_hub.set_own_presence(p_online boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  UPDATE whatsapp_hub.app_users
     SET is_online = p_online,
         last_seen_at = now()
   WHERE user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.set_own_presence(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.set_own_presence(boolean) TO authenticated;

-- Round-robin: usa presença recente em vez de is_online cru, e cai pro
-- round-robin puro quando ninguém do setor está "recentemente online".
CREATE OR REPLACE FUNCTION whatsapp_hub.next_department_assignee(
  p_department_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_enabled BOOLEAN := false;
  v_last UUID;
  v_last_position INT;
  v_next UUID;
BEGIN
  IF p_department_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT auto_assign_enabled
    INTO v_enabled
    FROM whatsapp_hub.app_settings
   WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN NULL;
  END IF;

  -- Uma atribuição por setor por vez; evita dois webhooks pegarem a mesma vez.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_department_id::text, 0));

  INSERT INTO whatsapp_hub.department_assignment_state (department_id)
  VALUES (p_department_id)
  ON CONFLICT (department_id) DO NOTHING;

  SELECT last_user_id
    INTO v_last
    FROM whatsapp_hub.department_assignment_state
   WHERE department_id = p_department_id
   FOR UPDATE;

  SELECT q.position
    INTO v_last_position
    FROM whatsapp_hub.lead_assignment_queue q
   WHERE q.department_id = p_department_id
     AND q.user_id = v_last;

  -- 1ª tentativa: só quem está recentemente online, a partir da posição atual.
  SELECT q.user_id
    INTO v_next
    FROM whatsapp_hub.lead_assignment_queue q
    JOIN whatsapp_hub.app_users au ON au.user_id = q.user_id
   WHERE q.department_id = p_department_id
     AND au.department_id = p_department_id
     AND au.role IN ('supervisor', 'operator')
     AND whatsapp_hub._is_recently_online(au.is_online, au.last_seen_at)
     AND (v_last_position IS NULL OR q.position > v_last_position)
   ORDER BY q.position, q.user_id
   LIMIT 1;

  IF v_next IS NULL THEN
    SELECT q.user_id
      INTO v_next
      FROM whatsapp_hub.lead_assignment_queue q
      JOIN whatsapp_hub.app_users au ON au.user_id = q.user_id
     WHERE q.department_id = p_department_id
       AND au.department_id = p_department_id
       AND au.role IN ('supervisor', 'operator')
       AND whatsapp_hub._is_recently_online(au.is_online, au.last_seen_at)
     ORDER BY q.position, q.user_id
     LIMIT 1;
  END IF;

  -- Rede de segurança: ninguém recentemente online no setor — não deixa a
  -- conversa sem responsável, cai pro round-robin puro (ignora presença),
  -- a partir da posição atual, com o mesmo wrap-around de antes.
  IF v_next IS NULL THEN
    SELECT q.user_id
      INTO v_next
      FROM whatsapp_hub.lead_assignment_queue q
      JOIN whatsapp_hub.app_users au ON au.user_id = q.user_id
     WHERE q.department_id = p_department_id
       AND au.department_id = p_department_id
       AND au.role IN ('supervisor', 'operator')
       AND (v_last_position IS NULL OR q.position > v_last_position)
     ORDER BY q.position, q.user_id
     LIMIT 1;
  END IF;

  IF v_next IS NULL THEN
    SELECT q.user_id
      INTO v_next
      FROM whatsapp_hub.lead_assignment_queue q
      JOIN whatsapp_hub.app_users au ON au.user_id = q.user_id
     WHERE q.department_id = p_department_id
       AND au.department_id = p_department_id
       AND au.role IN ('supervisor', 'operator')
     ORDER BY q.position, q.user_id
     LIMIT 1;
  END IF;

  IF v_next IS NOT NULL THEN
    UPDATE whatsapp_hub.department_assignment_state
       SET last_user_id = v_next, updated_at = now()
     WHERE department_id = p_department_id;
  END IF;

  RETURN v_next;
END;
$$;
