-- Agenda: um calendario pessoal por usuario + o calendario da empresa.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Duas naturezas na mesma tabela, separadas por owner_id, pelo mesmo motivo dos
-- funis: a diferenca entre "meu" e "de todos" e de dono, nao de estrutura, e
-- duas tabelas obrigariam a unir tudo de novo em toda leitura da tela.
CREATE TABLE IF NOT EXISTS whatsapp_hub.calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#3B82F6',
  -- null = calendario da empresa: todos leem, so gerencia e diretoria escrevem.
  owner_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- O da empresa e obrigatorio e nao pode ser apagado nem escondido.
  is_company  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendars_company_unico
  ON whatsapp_hub.calendars ((true)) WHERE is_company;

CREATE UNIQUE INDEX IF NOT EXISTS calendars_um_pessoal_por_usuario
  ON whatsapp_hub.calendars (owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_hub.calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id  uuid NOT NULL REFERENCES whatsapp_hub.calendars(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  all_day      boolean NOT NULL DEFAULT false,
  location     text,
  -- Quem criou. Guardado para o calendario da empresa mostrar a autoria: numa
  -- agenda que todos leem, "quem marcou isso" e a primeira pergunta.
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES whatsapp_hub.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES whatsapp_hub.conversations(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_intervalo CHECK (ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS calendar_events_cal_inicio_idx
  ON whatsapp_hub.calendar_events (calendar_id, starts_at);
CREATE INDEX IF NOT EXISTS calendar_events_inicio_idx
  ON whatsapp_hub.calendar_events (starts_at);

ALTER TABLE whatsapp_hub.calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendars_select ON whatsapp_hub.calendars;
CREATE POLICY calendars_select ON whatsapp_hub.calendars
  FOR SELECT TO authenticated
  USING (is_company OR owner_id = auth.uid());

DROP POLICY IF EXISTS calendars_insert ON whatsapp_hub.calendars;
CREATE POLICY calendars_insert ON whatsapp_hub.calendars
  FOR INSERT TO authenticated
  WITH CHECK (is_company = false AND owner_id = auth.uid());

DROP POLICY IF EXISTS calendars_update ON whatsapp_hub.calendars;
CREATE POLICY calendars_update ON whatsapp_hub.calendars
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND is_company = false)
  WITH CHECK (owner_id = auth.uid() AND is_company = false);

-- Sem delete do calendario da empresa: ele e obrigatorio.
DROP POLICY IF EXISTS calendars_delete ON whatsapp_hub.calendars;
CREATE POLICY calendars_delete ON whatsapp_hub.calendars
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND is_company = false);

DROP POLICY IF EXISTS calendar_events_select ON whatsapp_hub.calendar_events;
CREATE POLICY calendar_events_select ON whatsapp_hub.calendar_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM whatsapp_hub.calendars c
     WHERE c.id = calendar_events.calendar_id
       AND (c.is_company OR c.owner_id = auth.uid())
  ));

-- Escrita no calendario da empresa: so gerencia e diretoria (admin e
-- super_admin). Supervisor le, nao escreve — e um mural da empresa, nao um
-- quadro de avisos de setor.
DROP POLICY IF EXISTS calendar_events_write ON whatsapp_hub.calendar_events;
CREATE POLICY calendar_events_write ON whatsapp_hub.calendar_events
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM whatsapp_hub.calendars c
     WHERE c.id = calendar_events.calendar_id
       AND ((c.owner_id = auth.uid()) OR (c.is_company AND whatsapp_hub.is_admin()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM whatsapp_hub.calendars c
     WHERE c.id = calendar_events.calendar_id
       AND ((c.owner_id = auth.uid()) OR (c.is_company AND whatsapp_hub.is_admin()))
  ));

INSERT INTO whatsapp_hub.calendars (name, color, owner_id, is_company)
SELECT 'Calendário da empresa', '#F59E0B', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_hub.calendars WHERE is_company);

-- Um calendario pessoal por usuario existente. Novos usuarios ganham o seu por
-- trigger, abaixo — sem isso a agenda abriria vazia e sem onde criar nada.
INSERT INTO whatsapp_hub.calendars (name, color, owner_id, is_company)
SELECT 'Minha agenda', '#3B82F6', au.user_id, false
FROM whatsapp_hub.app_users au
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_hub.calendars c WHERE c.owner_id = au.user_id
);

CREATE OR REPLACE FUNCTION whatsapp_hub._criar_calendario_pessoal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
begin
  insert into whatsapp_hub.calendars (name, color, owner_id, is_company)
  values ('Minha agenda', '#3B82F6', NEW.user_id, false)
  on conflict do nothing;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS on_app_user_calendar ON whatsapp_hub.app_users;
CREATE TRIGGER on_app_user_calendar
  AFTER INSERT ON whatsapp_hub.app_users
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._criar_calendario_pessoal();
