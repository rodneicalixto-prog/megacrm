-- Módulo Jurídico — conversa fechada por processo.
--
-- 1:1 com legal_cases (o processo É o escopo da conversa), diferente de
-- internal_conversations que é DM entre pares de usuários — não reaproveita
-- essa tabela. "Pausar"/"excluir" do modelo visual: pausar persiste em
-- legal_cases.chat_paused_at (migration anterior); excluir fica só de UI por
-- ora, não apaga histórico de verdade.
SET search_path TO whatsapp_hub, public;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  sender_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_case_messages_case_idx ON whatsapp_hub.legal_case_messages (case_id, created_at);

CREATE OR REPLACE FUNCTION whatsapp_hub._bump_legal_case_last_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE whatsapp_hub.legal_cases
    SET last_message_at = NEW.created_at
    WHERE id = NEW.case_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_case_messages_bump_last_message ON whatsapp_hub.legal_case_messages;
CREATE TRIGGER legal_case_messages_bump_last_message
  AFTER INSERT ON whatsapp_hub.legal_case_messages
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._bump_legal_case_last_message();

ALTER TABLE whatsapp_hub.legal_case_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_case_messages_select ON whatsapp_hub.legal_case_messages
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

CREATE POLICY legal_case_messages_write ON whatsapp_hub.legal_case_messages
  FOR ALL TO authenticated
  USING (whatsapp_hub.can_access_legal())
  WITH CHECK (whatsapp_hub.can_access_legal());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.legal_case_messages TO authenticated;

ALTER TABLE whatsapp_hub.legal_case_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.legal_case_messages;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
