-- Corrige funcoes de trigger antigas que sobreviveram a remocao de tenant_id.
-- O evento de webhook era registrado, mas o INSERT em messages era revertido
-- por _on_inbound_notify ao acessar NEW.tenant_id.

SET search_path TO whatsapp_hub, public;

DROP FUNCTION IF EXISTS whatsapp_hub._fanout_notification(
  uuid, whatsapp_hub.notification_type, uuid, uuid, text, text
);

CREATE OR REPLACE FUNCTION whatsapp_hub._fanout_notification(
  p_type whatsapp_hub.notification_type,
  p_conversation_id uuid,
  p_message_id uuid,
  p_title text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  INSERT INTO whatsapp_hub.notifications (
    user_id, type, conversation_id, message_id, title, body
  )
  SELECT u.user_id, p_type, p_conversation_id, p_message_id, p_title, p_body
    FROM whatsapp_hub.app_users u
    JOIN whatsapp_hub.conversations c ON c.id = p_conversation_id
   WHERE u.user_id = c.assigned_to
      OR (
        c.assigned_to IS NULL
        AND (
          u.role = 'super_admin'
          OR (
            u.role = 'admin'
            AND NOT whatsapp_hub.department_is_restricted(c.department_id)
          )
          OR (
            u.role IN ('supervisor', 'operator')
            AND u.department_id = c.department_id
          )
        )
      );
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub._on_inbound_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  contact_name text;
  contact_phone text;
  title_txt text;
  body_txt text;
BEGIN
  IF NEW.direction <> 'inbound'
     OR NEW.sender_type <> 'contact'
     OR coalesce(NEW.is_private_note, false) = true
  THEN
    RETURN NEW;
  END IF;

  SELECT c.name, c.phone
    INTO contact_name, contact_phone
    FROM whatsapp_hub.conversations conv
    JOIN whatsapp_hub.contacts c ON c.id = conv.contact_id
   WHERE conv.id = NEW.conversation_id;

  title_txt := 'Nova mensagem de '
    || coalesce(nullif(contact_name, ''), contact_phone, 'contato');
  body_txt := left(coalesce(NEW.content, '[' || NEW.content_type::text || ']'), 140);

  PERFORM whatsapp_hub._fanout_notification(
    'new_message'::whatsapp_hub.notification_type,
    NEW.conversation_id,
    NEW.id,
    title_txt,
    body_txt
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub._on_handoff_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  contact_name text;
  contact_phone text;
  title_txt text;
BEGIN
  IF coalesce(OLD.ai_paused, false) = true
     OR coalesce(NEW.ai_paused, false) = false
  THEN
    RETURN NEW;
  END IF;

  SELECT c.name, c.phone
    INTO contact_name, contact_phone
    FROM whatsapp_hub.contacts c
   WHERE c.id = NEW.contact_id;

  title_txt := 'Handoff para humano: '
    || coalesce(nullif(contact_name, ''), contact_phone, 'contato');

  IF NEW.assigned_to IS NOT NULL THEN
    INSERT INTO whatsapp_hub.notifications (
      user_id, type, conversation_id, message_id, title, body
    ) VALUES (
      NEW.assigned_to,
      'handoff'::whatsapp_hub.notification_type,
      NEW.id,
      NULL,
      title_txt,
      'Conversa atribuida a voce - a IA foi pausada.'
    );
  ELSE
    PERFORM whatsapp_hub._fanout_notification(
      'handoff'::whatsapp_hub.notification_type,
      NEW.id,
      NULL,
      title_txt,
      'A IA foi pausada nessa conversa. Ela precisa de um atendente humano.'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Mantem a trava dura da IA no banco real. A definicao antiga ainda invocava
-- process-ai-message mesmo com o agente desligado.
CREATE OR REPLACE FUNCTION whatsapp_hub._on_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_active boolean;
BEGIN
  IF NEW.direction <> 'inbound'
     OR NEW.sender_type <> 'contact'
     OR coalesce(NEW.is_private_note, false) = true
  THEN
    RETURN NEW;
  END IF;

  SELECT a.is_active INTO v_active
    FROM whatsapp_hub.ai_agent_config a
   LIMIT 1;

  IF coalesce(v_active, false) = false THEN
    RETURN NEW;
  END IF;

  PERFORM whatsapp_hub._invoke_edge_with_body(
    'process-ai-message',
    jsonb_build_object('message_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF pg_get_functiondef('whatsapp_hub._on_inbound_notify()'::regprocedure)
       ILIKE '%NEW.tenant_id%'
     OR pg_get_functiondef('whatsapp_hub._on_handoff_notify()'::regprocedure)
       ILIKE '%NEW.tenant_id%'
  THEN
    RAISE EXCEPTION 'trigger residual ainda referencia tenant_id';
  END IF;
END;
$$;
