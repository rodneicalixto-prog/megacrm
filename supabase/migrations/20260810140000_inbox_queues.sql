-- Filas da coluna esquerda do inbox: prioridade e favoritos.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Prioridade da conversa. Fica na conversa (nao no contato) porque e uma
-- decisao do atendimento daquele momento, nao um atributo permanente de quem
-- escreveu.
ALTER TABLE whatsapp_hub.conversations
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_priority_check'
  ) THEN
    ALTER TABLE whatsapp_hub.conversations
      ADD CONSTRAINT conversations_priority_check
      CHECK (priority IN ('baixa', 'normal', 'alta'));
  END IF;
END $$;

-- Parcial: 'normal' e a esmagadora maioria e nunca e filtrada por si.
CREATE INDEX IF NOT EXISTS conversations_priority_idx
  ON whatsapp_hub.conversations (priority) WHERE priority <> 'normal';

-- Favoritos sao POR USUARIO, nao da instalacao. Numa fila compartilhada, uma
-- flag na conversa faria a estrela de um atendente aparecer para todos os
-- outros, e a fila "Favoritos" deixaria de ser dele.
CREATE TABLE IF NOT EXISTS whatsapp_hub.conversation_favorites (
  conversation_id uuid NOT NULL REFERENCES whatsapp_hub.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_favorites_user_idx
  ON whatsapp_hub.conversation_favorites (user_id);

ALTER TABLE whatsapp_hub.conversation_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_favorites_own ON whatsapp_hub.conversation_favorites;
CREATE POLICY conversation_favorites_own
  ON whatsapp_hub.conversation_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
