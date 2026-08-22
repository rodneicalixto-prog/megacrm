-- Chat interno: usuários da instância conversando entre si, fora do contexto
-- de atendimento a um contato. Não existia nada disso — nem no schema, nem em
-- código, nem documentado em PLANEJAMENTO.md/CLAUDE.md. O único resquício era
-- o valor 'mention' em whatsapp_hub.notification_type, criado no init e nunca
-- usado por nenhum trigger/edge function.
--
-- Escopo desta rodada (confirmado com o usuário): DM 1:1 apenas, sem canais
-- por setor e SEM regras de visibilidade por departamento — qualquer membro
-- da instância pode iniciar conversa com qualquer outro. Presença reaproveita
-- o heartbeat que já existe (app_users.is_online/last_seen_at, usado hoje pelo
-- round-robin) — nenhum mecanismo de presença novo.

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Tabelas
-- ----------------------------------------------------------------------------
-- Par de usuários normalizado (user_a < user_b) para que (A,B) e (B,A) sempre
-- caiam na mesma linha — a UNIQUE só funciona assim.
CREATE TABLE IF NOT EXISTS whatsapp_hub.internal_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  -- Marca de leitura por lado. Só escritas via mark_internal_conversation_read
  -- (abaixo) — não há policy de UPDATE direta, então ninguém adultera a marca
  -- do outro lado pelo client.
  last_read_a     TIMESTAMPTZ,
  last_read_b     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT internal_conversations_ordered CHECK (user_a < user_b),
  CONSTRAINT internal_conversations_pair_key UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS whatsapp_hub.internal_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES whatsapp_hub.internal_conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_messages_conversation
  ON whatsapp_hub.internal_messages(conversation_id, created_at);

-- ----------------------------------------------------------------------------
-- 2. RPCs
-- ----------------------------------------------------------------------------
-- get-or-create: o client só conhece o peer_id, nunca monta a linha na mão
-- (evitaria acertar a ordem user_a/user_b e correr atrás de conflito de
-- UNIQUE). ON CONFLICT DO UPDATE (no-op real) é o jeito padrão de fazer
-- upsert-e-retornar-id em uma via só.
CREATE OR REPLACE FUNCTION whatsapp_hub.get_or_create_internal_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, auth, public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_peer_id = v_me THEN
    RAISE EXCEPTION 'cannot start a conversation with yourself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM whatsapp_hub.app_users WHERE user_id = p_peer_id) THEN
    RAISE EXCEPTION 'peer is not a member of this instance';
  END IF;

  IF v_me < p_peer_id THEN v_a := v_me; v_b := p_peer_id;
  ELSE v_a := p_peer_id; v_b := v_me;
  END IF;

  INSERT INTO whatsapp_hub.internal_conversations (user_a, user_b)
  VALUES (v_a, v_b)
  ON CONFLICT (user_a, user_b) DO UPDATE SET user_a = EXCLUDED.user_a
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.get_or_create_internal_conversation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.get_or_create_internal_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION whatsapp_hub.mark_internal_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, auth, public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  UPDATE whatsapp_hub.internal_conversations
     SET last_read_a = CASE WHEN user_a = v_me THEN now() ELSE last_read_a END,
         last_read_b = CASE WHEN user_b = v_me THEN now() ELSE last_read_b END
   WHERE id = p_conversation_id
     AND (user_a = v_me OR user_b = v_me);
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.mark_internal_conversation_read(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.mark_internal_conversation_read(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Trigger — last_message_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub._bump_internal_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  UPDATE whatsapp_hub.internal_conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_internal_conversation ON whatsapp_hub.internal_messages;
CREATE TRIGGER trg_bump_internal_conversation
  AFTER INSERT ON whatsapp_hub.internal_messages
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._bump_internal_conversation();

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.internal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.internal_messages      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_conversations_select ON whatsapp_hub.internal_conversations;
CREATE POLICY internal_conversations_select ON whatsapp_hub.internal_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() IN (user_a, user_b));

-- Sem policy de INSERT/UPDATE: só as RPCs SECURITY DEFINER acima escrevem
-- aqui. Isso impede o client de criar a linha com o par errado ou de marcar
-- como lida a marca do OUTRO participante.

DROP POLICY IF EXISTS internal_messages_select ON whatsapp_hub.internal_messages;
CREATE POLICY internal_messages_select ON whatsapp_hub.internal_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_hub.internal_conversations c
       WHERE c.id = internal_messages.conversation_id
         AND auth.uid() IN (c.user_a, c.user_b)
    )
  );

DROP POLICY IF EXISTS internal_messages_insert ON whatsapp_hub.internal_messages;
CREATE POLICY internal_messages_insert ON whatsapp_hub.internal_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM whatsapp_hub.internal_conversations c
       WHERE c.id = internal_messages.conversation_id
         AND auth.uid() IN (c.user_a, c.user_b)
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Realtime
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.internal_conversations;
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.internal_messages;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. list_operators() ganha presença — a lista de contatos internos precisa
--    saber quem está ativo, e o heartbeat (app_users.is_online/last_seen_at)
--    já existe pro round-robin. Sem isso o front teria que rodar uma segunda
--    query só pra presença.
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE não troca o shape de RETURNS TABLE; precisa dropar antes.
DROP FUNCTION IF EXISTS whatsapp_hub.list_operators();

CREATE FUNCTION whatsapp_hub.list_operators()
RETURNS TABLE(user_id uuid, email text, role whatsapp_hub.tenant_role,
              full_name text, department_id uuid, department_name text,
              is_online boolean, last_seen_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'auth', 'public', 'pg_temp'
AS $$
  SELECT au.user_id, u.email::text, au.role,
         coalesce(nullif(au.full_name, ''), u.raw_user_meta_data->>'full_name') AS full_name,
         au.department_id, d.name AS department_name,
         coalesce(au.is_online, false), au.last_seen_at
    FROM whatsapp_hub.app_users au
    JOIN auth.users u ON u.id = au.user_id
    LEFT JOIN whatsapp_hub.departments d ON d.id = au.department_id
   ORDER BY au.role, coalesce(nullif(au.full_name, ''), u.email::text);
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.list_operators() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.list_operators() TO authenticated;
