-- Distribuição automática de leads (round-robin) passa a considerar só
-- supervisor/atendente com app_users.is_online = true. Antes, a fila girava
-- em sequência pura e podia atribuir a conversa a alguém offline, que só a
-- veria ao voltar. Decisão de produto que estava deliberadamente adiada
-- (ver PLANEJAMENTO.md seção 9, "Decisões de produto adiadas") — agora
-- confirmada pelo usuário.
--
-- Mantém o mesmo ponteiro circular (department_assignment_state.last_user_id)
-- por posição, mas pula quem está offline; se ninguém do setor estiver
-- online, retorna NULL (o handoff segue sem atribuir, como já acontecia
-- quando a fila estava vazia ou desativada).

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

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

  SELECT q.user_id
    INTO v_next
    FROM whatsapp_hub.lead_assignment_queue q
    JOIN whatsapp_hub.app_users au ON au.user_id = q.user_id
   WHERE q.department_id = p_department_id
     AND au.department_id = p_department_id
     AND au.role IN ('supervisor', 'operator')
     AND au.is_online = true
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
       AND au.is_online = true
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
