CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Grupos sao uma organizacao pessoal da Inbox. Eles nao alteram atribuicao,
-- departamento ou RLS da conversa e, por isso, nunca vazam a lista de um
-- atendente para outro.
CREATE TABLE whatsapp_hub.attendance_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  color text NOT NULL DEFAULT '#3B82F6' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE whatsapp_hub.attendance_group_conversations (
  group_id uuid NOT NULL REFERENCES whatsapp_hub.attendance_groups(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_hub.conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, conversation_id)
);

CREATE INDEX attendance_group_conversations_conversation_idx
  ON whatsapp_hub.attendance_group_conversations (conversation_id);

ALTER TABLE whatsapp_hub.attendance_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.attendance_group_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_groups_own ON whatsapp_hub.attendance_groups
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY attendance_group_conversations_own ON whatsapp_hub.attendance_group_conversations
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM whatsapp_hub.attendance_groups g
    WHERE g.id = group_id AND g.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM whatsapp_hub.attendance_groups g
    WHERE g.id = group_id AND g.user_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.attendance_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.attendance_group_conversations TO authenticated;

-- A faixa de acesso rapido e deliberadamente curta. A trava no banco evita
-- que duas abas concorrentes ultrapassem o limite de cinco favoritos.
CREATE OR REPLACE FUNCTION whatsapp_hub.limit_conversation_favorites()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = whatsapp_hub, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));
  IF (SELECT count(*) FROM whatsapp_hub.conversation_favorites WHERE user_id = NEW.user_id) >= 5 THEN
    RAISE EXCEPTION 'favorite_limit_reached' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_conversation_favorites_limit ON whatsapp_hub.conversation_favorites;
CREATE TRIGGER enforce_conversation_favorites_limit
  BEFORE INSERT ON whatsapp_hub.conversation_favorites
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub.limit_conversation_favorites();

-- Encaminhar concede acesso ao contato sem compartilhar a lista inteira.
CREATE TABLE whatsapp_hub.contact_forwards (
  contact_id uuid NOT NULL REFERENCES whatsapp_hub.contacts(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);
ALTER TABLE whatsapp_hub.contact_forwards ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_forwards_participants ON whatsapp_hub.contact_forwards
  FOR SELECT TO authenticated USING (auth.uid() IN (from_user_id, to_user_id));
GRANT SELECT ON whatsapp_hub.contact_forwards TO authenticated;

CREATE OR REPLACE FUNCTION whatsapp_hub.forward_contact(p_contact_id uuid, p_to_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = whatsapp_hub, pg_temp AS $$
DECLARE
  v_from whatsapp_hub.app_users%ROWTYPE;
  v_to whatsapp_hub.app_users%ROWTYPE;
  v_from_rank int;
  v_to_rank int;
BEGIN
  SELECT * INTO v_from FROM whatsapp_hub.app_users WHERE user_id = auth.uid() AND is_active;
  SELECT * INTO v_to FROM whatsapp_hub.app_users WHERE user_id = p_to_user_id AND is_active;
  IF v_from.user_id IS NULL OR v_to.user_id IS NULL THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
  IF NOT EXISTS (SELECT 1 FROM whatsapp_hub.contacts WHERE id = p_contact_id)
     OR NOT (
       whatsapp_hub.sees_all_departments()
       OR EXISTS (SELECT 1 FROM whatsapp_hub.contact_forwards f WHERE f.contact_id = p_contact_id AND f.to_user_id = auth.uid())
       OR EXISTS (
         SELECT 1 FROM whatsapp_hub.conversations c WHERE c.contact_id = p_contact_id
           AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
           AND ((v_from.role = 'supervisor' AND c.department_id = v_from.department_id)
             OR (v_from.role = 'operator' AND c.assigned_to = auth.uid()))
       )
     ) THEN
    RAISE EXCEPTION 'contact_not_visible';
  END IF;
  v_from_rank := CASE v_from.role WHEN 'super_admin' THEN 4 WHEN 'admin' THEN 3 WHEN 'supervisor' THEN 2 ELSE 1 END;
  v_to_rank := CASE v_to.role WHEN 'super_admin' THEN 4 WHEN 'admin' THEN 3 WHEN 'supervisor' THEN 2 ELSE 1 END;
  IF v_to_rank > v_from_rank OR (v_from.role IN ('supervisor','operator') AND v_to.department_id IS DISTINCT FROM v_from.department_id) THEN
    RAISE EXCEPTION 'hierarchy_denied';
  END IF;
  INSERT INTO whatsapp_hub.contact_forwards(contact_id, from_user_id, to_user_id)
  VALUES (p_contact_id, auth.uid(), p_to_user_id)
  ON CONFLICT (contact_id, to_user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION whatsapp_hub.forward_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_hub.forward_contact(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS contacts_select ON whatsapp_hub.contacts;
CREATE POLICY contacts_select ON whatsapp_hub.contacts FOR SELECT TO authenticated USING (
  whatsapp_hub.sees_all_departments()
  OR EXISTS (SELECT 1 FROM whatsapp_hub.contact_forwards f WHERE f.contact_id = contacts.id AND f.to_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM whatsapp_hub.conversations c WHERE c.contact_id = contacts.id
      AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
      AND ((whatsapp_hub.current_user_role() = 'supervisor' AND c.department_id = whatsapp_hub.current_user_department())
        OR (whatsapp_hub.current_user_role() = 'operator' AND c.assigned_to = auth.uid()))
  )
);
