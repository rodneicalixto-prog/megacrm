-- Closed conversations cannot remain unread or keep actionable notifications.

SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub._normalize_closed_conversation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'closed' THEN
    NEW.unread_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_closed_conversation ON whatsapp_hub.conversations;
CREATE TRIGGER normalize_closed_conversation
  BEFORE INSERT OR UPDATE OF status, unread_count
  ON whatsapp_hub.conversations
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._normalize_closed_conversation();

CREATE OR REPLACE FUNCTION whatsapp_hub._resolve_closed_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE whatsapp_hub.notifications
       SET is_read = true
     WHERE conversation_id = NEW.id
       AND is_read = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_closed_notifications ON whatsapp_hub.conversations;
CREATE TRIGGER resolve_closed_notifications
  AFTER UPDATE OF status
  ON whatsapp_hub.conversations
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._resolve_closed_notifications();

UPDATE whatsapp_hub.conversations
   SET unread_count = 0
 WHERE status = 'closed'
   AND unread_count <> 0;

UPDATE whatsapp_hub.notifications AS notification
   SET is_read = true
  FROM whatsapp_hub.conversations AS conversation
 WHERE notification.conversation_id = conversation.id
   AND conversation.status = 'closed'
   AND notification.is_read = false;