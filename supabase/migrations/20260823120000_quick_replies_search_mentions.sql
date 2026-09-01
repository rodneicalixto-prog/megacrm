-- Onda 1 do pacote "Inbox rápido" (PLANEJAMENTO.md): respostas rápidas
-- (/atalho), busca dentro da conversa e @menções em notas privadas.
--
-- @menções reaproveita infra que já existia sem uso: o enum
-- whatsapp_hub.notification_type já tinha 'mention' desde o init
-- (20260422120001_init.sql), mas nenhum trigger disparava esse tipo — só o
-- chat interno (20260822150000_internal_chat.sql) comentava isso. Aqui é a
-- primeira vez que 'mention' sai do papel.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Respostas rápidas (/atalho)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.quick_replies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut   TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quick_replies_shortcut_format CHECK (shortcut ~ '^[a-z0-9_-]{1,40}$')
);

DROP TRIGGER IF EXISTS trg_quick_replies_updated_at ON whatsapp_hub.quick_replies;
CREATE TRIGGER trg_quick_replies_updated_at
  BEFORE UPDATE ON whatsapp_hub.quick_replies
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub.set_updated_at();

ALTER TABLE whatsapp_hub.quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_replies_select ON whatsapp_hub.quick_replies;
CREATE POLICY quick_replies_select ON whatsapp_hub.quick_replies
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_operate());

DROP POLICY IF EXISTS quick_replies_insert ON whatsapp_hub.quick_replies;
CREATE POLICY quick_replies_insert ON whatsapp_hub.quick_replies
  FOR INSERT TO authenticated
  WITH CHECK (whatsapp_hub.can_operate() AND created_by = auth.uid());

-- Qualquer operador atualiza/apaga o próprio atalho; admin+ pode mexer nos de
-- todo mundo (evita atalho órfão travado quando quem criou sai da equipe).
DROP POLICY IF EXISTS quick_replies_update ON whatsapp_hub.quick_replies;
CREATE POLICY quick_replies_update ON whatsapp_hub.quick_replies
  FOR UPDATE TO authenticated
  USING (whatsapp_hub.can_operate() AND (created_by = auth.uid() OR whatsapp_hub.is_admin()))
  WITH CHECK (whatsapp_hub.can_operate() AND (created_by = auth.uid() OR whatsapp_hub.is_admin()));

DROP POLICY IF EXISTS quick_replies_delete ON whatsapp_hub.quick_replies;
CREATE POLICY quick_replies_delete ON whatsapp_hub.quick_replies
  FOR DELETE TO authenticated
  USING (whatsapp_hub.can_operate() AND (created_by = auth.uid() OR whatsapp_hub.is_admin()));

-- ----------------------------------------------------------------------------
-- 2. Busca dentro da conversa
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON whatsapp_hub.messages USING GIN (search_vector);

-- SECURITY INVOKER (padrão): corre com os privilégios de quem chama, então a
-- RLS de messages_select decide o que a busca pode ver — sem isso, um
-- operator conseguiria buscar texto em conversas de outro departamento.
CREATE OR REPLACE FUNCTION whatsapp_hub.search_conversation_messages(
  p_conversation_id uuid,
  p_query text
)
RETURNS TABLE(id uuid, content text, created_at timestamptz, rank real)
LANGUAGE sql STABLE
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  SELECT m.id, m.content, m.created_at,
         ts_rank(m.search_vector, websearch_to_tsquery('portuguese', p_query)) AS rank
    FROM whatsapp_hub.messages m
   WHERE m.conversation_id = p_conversation_id
     AND m.search_vector @@ websearch_to_tsquery('portuguese', p_query)
   ORDER BY m.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.search_conversation_messages(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.search_conversation_messages(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. @Menções entre operadores em notas privadas
-- ----------------------------------------------------------------------------
-- Guardamos os IDs mencionados (resolvidos no client a partir do @nome contra
-- a lista de operadores) em vez de reparsear texto livre no trigger — mais
-- simples e nao quebra se o nome do operador mudar depois.
ALTER TABLE whatsapp_hub.messages
  ADD COLUMN IF NOT EXISTS mentioned_user_ids UUID[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION whatsapp_hub._on_mention_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  sender_name text;
  mentioned_id uuid;
  title_txt text;
  body_txt text;
BEGIN
  IF coalesce(NEW.is_private_note, false) = false
     OR NEW.mentioned_user_ids IS NULL
     OR array_length(NEW.mentioned_user_ids, 1) IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(au.full_name, ''), u.email::text)
    INTO sender_name
    FROM whatsapp_hub.app_users au
    JOIN auth.users u ON u.id = au.user_id
   WHERE au.user_id = NEW.sender_id;

  title_txt := 'Você foi mencionado por ' || coalesce(sender_name, 'um colega');
  body_txt  := left(coalesce(NEW.content, ''), 140);

  FOREACH mentioned_id IN ARRAY NEW.mentioned_user_ids
  LOOP
    IF mentioned_id IS NULL OR mentioned_id = NEW.sender_id THEN
      CONTINUE;
    END IF;
    INSERT INTO whatsapp_hub.notifications (
      user_id, type, conversation_id, message_id, title, body
    ) VALUES (
      mentioned_id,
      'mention'::whatsapp_hub.notification_type,
      NEW.conversation_id,
      NEW.id,
      title_txt,
      body_txt
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_mention_notify ON whatsapp_hub.messages;
CREATE TRIGGER on_mention_notify
  AFTER INSERT ON whatsapp_hub.messages
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._on_mention_notify();
