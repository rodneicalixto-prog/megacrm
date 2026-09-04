-- Módulo Jurídico — painel de inteligência v2: instância processual, plano de
-- ação de prevenção com dono real + SWOT + 5W2H (deixa de ser texto estático
-- no frontend — agora precisa de responsável rastreável, então vira tabela).
SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Instância processual
-- ----------------------------------------------------------------------------
-- Nomenclatura do próprio usuário ("segunda instância, terceira instância,
-- tribunal superior"), não é terminologia CNJ estrita (formalmente só há 1ª e
-- 2ª instância + tribunais superiores/extraordinários) — mantida como o
-- negócio pediu, documentado aqui pra quem ler depois não estranhar.
DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_case_instance AS ENUM (
    'primeira_instancia',
    'segunda_instancia',
    'terceira_instancia',
    'tribunal_superior'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE whatsapp_hub.legal_cases
  ADD COLUMN IF NOT EXISTS instance whatsapp_hub.legal_case_instance NOT NULL DEFAULT 'primeira_instancia';

-- ----------------------------------------------------------------------------
-- 2. Plano de ação de prevenção — por causa/classificação, com dono real.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_action_plan_status AS ENUM ('planejado', 'em_andamento', 'concluido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_action_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Livre, casa com legal_cases.classification por convenção — não é FK
  -- porque é um agrupador (a mesma causa aparece em vários processos), não
  -- um relacionamento 1:1 com um processo específico.
  classification     text NOT NULL,
  title              text NOT NULL,
  owner_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status             whatsapp_hub.legal_action_plan_status NOT NULL DEFAULT 'planejado',
  swot_strengths     jsonb NOT NULL DEFAULT '[]'::jsonb,
  swot_weaknesses    jsonb NOT NULL DEFAULT '[]'::jsonb,
  swot_opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  swot_threats       jsonb NOT NULL DEFAULT '[]'::jsonb,
  w5h2_what          text, -- O quê
  w5h2_why           text, -- Por quê
  w5h2_where         text, -- Onde
  w5h2_when          date, -- Quando
  w5h2_who           text, -- Quem (texto livre — pode ser um time, não é sempre = owner_id)
  w5h2_how           text, -- Como
  w5h2_how_much      text, -- Quanto custa
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_action_plans_classification_idx ON whatsapp_hub.legal_action_plans (classification);

CREATE OR REPLACE FUNCTION whatsapp_hub._touch_legal_action_plan_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_action_plans_touch_updated_at ON whatsapp_hub.legal_action_plans;
CREATE TRIGGER legal_action_plans_touch_updated_at
  BEFORE UPDATE ON whatsapp_hub.legal_action_plans
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._touch_legal_action_plan_updated_at();

ALTER TABLE whatsapp_hub.legal_action_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_action_plans_select ON whatsapp_hub.legal_action_plans
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

CREATE POLICY legal_action_plans_write ON whatsapp_hub.legal_action_plans
  FOR ALL TO authenticated
  USING (whatsapp_hub.can_access_legal())
  WITH CHECK (whatsapp_hub.can_access_legal());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.legal_action_plans TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Painel — instance_breakdown + year_breakdown adicionados ao jsonb já
--    existente. As 3 chaves antigas (volume_by_status, outcome_breakdown,
--    classification_ranking) ficam exatamente como estavam.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub.legal_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT whatsapp_hub.can_access_legal() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT jsonb_build_object(
    'volume_by_status', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
      FROM (
        SELECT status::text AS status, count(*) AS cnt
        FROM whatsapp_hub.legal_cases
        GROUP BY status
      ) s
    ),
    'outcome_breakdown', (
      SELECT COALESCE(jsonb_object_agg(outcome, cnt), '{}'::jsonb)
      FROM (
        SELECT outcome::text AS outcome, count(*) AS cnt
        FROM whatsapp_hub.legal_cases
        WHERE outcome IS NOT NULL
        GROUP BY outcome
      ) o
    ),
    'classification_ranking', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('classification', classification, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT classification, count(*) AS cnt
        FROM whatsapp_hub.legal_cases
        WHERE classification IS NOT NULL
        GROUP BY classification
      ) c
    ),
    'instance_breakdown', (
      SELECT COALESCE(jsonb_object_agg(instance, cnt), '{}'::jsonb)
      FROM (
        SELECT instance::text AS instance, count(*) AS cnt
        FROM whatsapp_hub.legal_cases
        GROUP BY instance
      ) i
    ),
    'year_breakdown', (
      SELECT COALESCE(jsonb_object_agg(yr, cnt), '{}'::jsonb)
      FROM (
        SELECT extract(year FROM created_at)::text AS yr, count(*) AS cnt
        FROM whatsapp_hub.legal_cases
        GROUP BY extract(year FROM created_at)
      ) y
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.legal_dashboard_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.legal_dashboard_stats() TO authenticated, service_role;
