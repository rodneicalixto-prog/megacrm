-- Reuniões por Google Meet, agendadas a partir de UMA conta Google
-- compartilhada (o "Gmail fixo" pedido — nenhum departamento tem a própria
-- conta, evitando gerenciar N credenciais Google). Qualquer operador de
-- qualquer departamento agenda; a reunião nasce na agenda dessa conta única.
--
-- Gravação/transcrição/resumo são OPCIONAIS: dependem de um bot de terceiros
-- (Recall.ai — ver _shared/recall.ts) configurado em Configurações. Sem a
-- credencial, a reunião ainda é criada e o link do Meet ainda funciona; só
-- não há gravação/resumo automáticos.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.meeting_status AS ENUM (
    'scheduled',   -- criada no Google Calendar; se houver bot, ainda vai entrar
    'recording',    -- bot confirmou entrada na chamada
    'processing',   -- chamada terminou, gerando transcrição/resumo
    'completed',    -- gravação + transcrição + resumo prontos (ou reunião sem bot, encerrada manualmente)
    'failed',       -- erro ao criar no Google/Recall, ou bot falhou em entrar
    'canceled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_hub.meetings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text,
  -- NULL = reunião geral, sem departamento específico.
  department_id   uuid REFERENCES whatsapp_hub.departments(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  attendees       jsonb NOT NULL DEFAULT '[]'::jsonb, -- string[] de e-mails
  status          whatsapp_hub.meeting_status NOT NULL DEFAULT 'scheduled',
  -- Lado Google (conta única compartilhada).
  google_event_id text,
  meet_link       text,
  -- Lado Recall.ai (opcional).
  recall_bot_id   text,
  recording_url   text,
  transcript      text,
  summary         text,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetings_intervalo CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS meetings_starts_at_idx ON whatsapp_hub.meetings (starts_at DESC);
CREATE INDEX IF NOT EXISTS meetings_department_idx ON whatsapp_hub.meetings (department_id);
CREATE INDEX IF NOT EXISTS meetings_recall_bot_idx ON whatsapp_hub.meetings (recall_bot_id) WHERE recall_bot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION whatsapp_hub._touch_meeting_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_touch_updated_at ON whatsapp_hub.meetings;
CREATE TRIGGER meetings_touch_updated_at
  BEFORE UPDATE ON whatsapp_hub.meetings
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._touch_meeting_updated_at();

ALTER TABLE whatsapp_hub.meetings ENABLE ROW LEVEL SECURITY;

-- Acervo compartilhado: qualquer membro da instância acessa e pesquisa
-- qualquer reunião — é exatamente o "fácil acesso a este acervo" pedido, não
-- um recorte por departamento (a própria ideia de UM Gmail fixo já é
-- deliberadamente não-departamentalizada).
DROP POLICY IF EXISTS meetings_select ON whatsapp_hub.meetings;
CREATE POLICY meetings_select ON whatsapp_hub.meetings
  FOR SELECT TO authenticated
  USING (true);

-- SEM policy de INSERT para authenticated: criar reunião exige chamar o
-- Google Calendar (link do Meet) e, se configurado, agendar o bot de
-- gravação — isso só acontece na Edge Function `schedule-meeting`, que usa a
-- service role e por isso ignora RLS. Um INSERT direto pelo client criaria
-- uma linha "fantasma" sem meet_link nenhum.
--
-- Só quem criou (ou admin/super_admin) cancela/edita título e descrição.
DROP POLICY IF EXISTS meetings_update ON whatsapp_hub.meetings;
CREATE POLICY meetings_update ON whatsapp_hub.meetings
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR whatsapp_hub.is_admin())
  WITH CHECK (created_by = auth.uid() OR whatsapp_hub.is_admin());

DROP POLICY IF EXISTS meetings_delete ON whatsapp_hub.meetings;
CREATE POLICY meetings_delete ON whatsapp_hub.meetings
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR whatsapp_hub.is_admin());

ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.meetings;
