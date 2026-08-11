CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Uma conversa precisa continuar ligada à linha que a recebeu para que toda
-- resposta futura saia pelo mesmo número. ON DELETE SET NULL descartava essa
-- informação e fazia o outbound cair na credencial Evolution global.
ALTER TABLE whatsapp_hub.conversations
  DROP CONSTRAINT IF EXISTS conversations_connection_id_fkey;

ALTER TABLE whatsapp_hub.conversations
  ADD CONSTRAINT conversations_connection_id_fkey
  FOREIGN KEY (connection_id)
  REFERENCES whatsapp_hub.department_connections(id)
  ON DELETE RESTRICT;
