-- Ordem de atendimento por setor.
--
-- Linhas pessoais continuam fora da fila: department_connections.position_id
-- resolve diretamente para department_positions.user_id. Somente uma linha sem
-- cargo consulta esta fila, que aceita supervisor/atendente e nunca admins.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.lead_assignment_queue
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES whatsapp_hub.departments(id) ON DELETE CASCADE;

UPDATE whatsapp_hub.lead_assignment_queue q
   SET department_id = au.department_id
  FROM whatsapp_hub.app_users au
 WHERE au.user_id = q.user_id
   AND q.department_id IS NULL;

-- Administradores atendem somente nas linhas pessoais. Remov?-los da fila
-- tamb?m corrige configura??es antigas que permitiam adicion?-los.
DELETE FROM whatsapp_hub.lead_assignment_queue q
 USING whatsapp_hub.app_users au
 WHERE au.user_id = q.user_id
   AND au.role IN ('super_admin', 'admin');

DELETE FROM whatsapp_hub.lead_assignment_queue WHERE department_id IS NULL;

ALTER TABLE whatsapp_hub.lead_assignment_queue
  ALTER COLUMN department_id SET NOT NULL;

ALTER TABLE whatsapp_hub.lead_assignment_queue
  DROP CONSTRAINT IF EXISTS lead_assignment_queue_pkey;
ALTER TABLE whatsapp_hub.lead_assignment_queue
  ADD CONSTRAINT lead_assignment_queue_pkey PRIMARY KEY (department_id, user_id);

DROP INDEX IF EXISTS whatsapp_hub.idx_lead_queue_position;
CREATE INDEX IF NOT EXISTS lead_assignment_queue_department_position_key
  ON whatsapp_hub.lead_assignment_queue(department_id, position);

CREATE TABLE IF NOT EXISTS whatsapp_hub.department_assignment_state (
  department_id UUID PRIMARY KEY
    REFERENCES whatsapp_hub.departments(id) ON DELETE CASCADE,
  last_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_hub.department_assignment_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_hub.department_assignment_state FROM PUBLIC, anon, authenticated;

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

  -- Uma atribui??o por setor por vez; evita dois webhooks pegarem a mesma vez.
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

REVOKE EXECUTE ON FUNCTION whatsapp_hub.next_department_assignee(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.next_department_assignee(UUID) TO service_role;

-- O handoff legado passa a respeitar o setor. Isso evita que uma atualiza??o
-- futura reative a IA e distribua uma conversa para algu?m de outro setor.
CREATE OR REPLACE FUNCTION whatsapp_hub._on_handoff_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_next UUID;
BEGIN
  IF COALESCE(OLD.ai_paused, false) = true
     OR COALESCE(NEW.ai_paused, false) = false
     OR NEW.assigned_to IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  v_next := whatsapp_hub.next_department_assignee(NEW.department_id);
  IF v_next IS NOT NULL THEN
    NEW.assigned_to := v_next;
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END;
$$;
