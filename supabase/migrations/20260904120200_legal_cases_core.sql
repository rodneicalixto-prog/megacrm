-- Módulo Jurídico — núcleo: processos, tarefas com checklist, participantes.
--
-- Segue o esqueleto de whatsapp_hub.meetings (tabela + RLS + realtime) e o
-- padrão de RLS em loop de crm_layer.sql (gate plano por função, não por
-- linha — ver can_access_legal() em 20260904120000_legal_access_control.sql).
SET search_path TO whatsapp_hub, public;

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_case_status AS ENUM (
    'em_andamento',
    'atrasado',
    'elaborando_defesa',
    'pendente_documentacao',
    'encerrado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NULL enquanto o processo está aberto; preenchido só no encerramento —
-- alimenta o ranking de causas/desfecho do painel de inteligência.
DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_case_outcome AS ENUM (
    'acordo',
    'procedente',
    'improcedente'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 1. Tabelas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_cases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Judicial: número CNJ. Interno (ex.: auditoria de conformidade): NULL.
  case_number         text,
  title               text NOT NULL,
  -- Todo processo pertence a um setor, mesmo o gate de acesso sendo plano —
  -- é o que sustenta reporting por departamento depois. ON DELETE RESTRICT
  -- de propósito: apagar um setor com processo vinculado é erro, não cascata.
  department_id       uuid NOT NULL REFERENCES whatsapp_hub.departments(id) ON DELETE RESTRICT,
  status              whatsapp_hub.legal_case_status NOT NULL DEFAULT 'em_andamento',
  outcome             whatsapp_hub.legal_case_outcome,
  next_deadline_at    timestamptz,
  next_deadline_label text,
  owner_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_counsel    text,
  opposing_party      text,
  court_reference     text,
  -- Denormalizados: sempre a versão mais recente de legal_case_briefings
  -- (mantidos em sync por trigger em 20260904120600_legal_case_briefings.sql).
  classification      text,
  summary             text,
  -- Chat fechado por processo (20260904120500_legal_case_messages.sql):
  -- "pausar" persiste aqui; "excluir" fica só de UI por ora.
  chat_paused_at      timestamptz,
  last_message_at     timestamptz,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_cases_department_idx ON whatsapp_hub.legal_cases (department_id);
CREATE INDEX IF NOT EXISTS legal_cases_status_idx     ON whatsapp_hub.legal_cases (status);
CREATE INDEX IF NOT EXISTS legal_cases_deadline_idx   ON whatsapp_hub.legal_cases (next_deadline_at) WHERE next_deadline_at IS NOT NULL;

-- "Quem acompanha" — responsável interno, advogado externo, preposto etc.
-- Lista informativa/de atenção, independente do gate de acesso (que segue
-- sendo can_access_legal() em toda tabela, não uma membership hard-gate).
CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  -- Advogado externo não tem conta no sistema — por isso os dois campos
  -- opcionais em vez de user_id obrigatório.
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_name text,
  role_label    text NOT NULL,
  added_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_case_participants_identity_chk CHECK (user_id IS NOT NULL OR external_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS legal_case_participants_case_idx ON whatsapp_hub.legal_case_participants (case_id);

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_tasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  title      text NOT NULL,
  due_at     timestamptz,
  owner_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done       boolean NOT NULL DEFAULT false,
  done_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_case_tasks_case_idx ON whatsapp_hub.legal_case_tasks (case_id);
CREATE INDEX IF NOT EXISTS legal_case_tasks_due_idx  ON whatsapp_hub.legal_case_tasks (due_at) WHERE NOT done;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_checklist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES whatsapp_hub.legal_case_tasks(id) ON DELETE CASCADE,
  label      text NOT NULL,
  position   int NOT NULL DEFAULT 0,
  done       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_case_checklist_items_task_idx ON whatsapp_hub.legal_case_checklist_items (task_id, position);

-- ----------------------------------------------------------------------------
-- 2. updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub._touch_legal_case_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_cases_touch_updated_at ON whatsapp_hub.legal_cases;
CREATE TRIGGER legal_cases_touch_updated_at
  BEFORE UPDATE ON whatsapp_hub.legal_cases
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._touch_legal_case_updated_at();

CREATE OR REPLACE FUNCTION whatsapp_hub._touch_legal_case_task_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_case_tasks_touch_updated_at ON whatsapp_hub.legal_case_tasks;
CREATE TRIGGER legal_case_tasks_touch_updated_at
  BEFORE UPDATE ON whatsapp_hub.legal_case_tasks
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._touch_legal_case_task_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS — gate plano via can_access_legal() em todas as tabelas do módulo.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_cases', 'legal_case_participants', 'legal_case_tasks', 'legal_case_checklist_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE whatsapp_hub.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON whatsapp_hub.%I FOR SELECT TO authenticated USING (whatsapp_hub.can_access_legal())',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON whatsapp_hub.%I FOR ALL TO authenticated '
      || 'USING (whatsapp_hub.can_access_legal()) '
      || 'WITH CHECK (whatsapp_hub.can_access_legal())',
      t || '_write', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  whatsapp_hub.legal_cases, whatsapp_hub.legal_case_participants,
  whatsapp_hub.legal_case_tasks, whatsapp_hub.legal_case_checklist_items
TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Realtime
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.legal_cases              REPLICA IDENTITY FULL;
ALTER TABLE whatsapp_hub.legal_case_tasks          REPLICA IDENTITY FULL;
ALTER TABLE whatsapp_hub.legal_case_checklist_items REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.legal_cases;
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.legal_case_tasks;
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.legal_case_checklist_items;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
