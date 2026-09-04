-- Módulo Jurídico — contexto de RH do funcionário que está processando a
-- empresa (a "parte contrária" do processo), pra cruzar reclamações com
-- turno/gestor/tempo de casa/histórico disciplinar. Cadastro PRÓPRIO deste
-- módulo, sem integração com folha/RH externo (decisão do usuário) —
-- preenchido manualmente por quem acompanha o processo.
--
-- 1:1 com legal_cases (cada processo trabalhista tem UM funcionário
-- reclamante) — diferente de legal_case_witnesses, que são N testemunhas.
SET search_path TO whatsapp_hub, public;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_employee_context (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                         uuid NOT NULL UNIQUE REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  employee_name                   text,
  department                      text, -- setor do FUNCIONÁRIO na empresa (texto livre — não é o mesmo eixo de legal_cases.department_id, que é o setor jurídico responsável pelo caso)
  role_title                      text, -- função
  manager_name                    text, -- gestor
  shift                           text, -- turno (texto livre — "Manhã"/"Tarde"/"Noite"/"Comercial" etc, varia por empresa)
  hire_date                       date, -- admissão — tempo de empresa é calculado a partir daqui, não guardado
  termination_date                date, -- desligamento, se já saiu
  had_written_warning             boolean NOT NULL DEFAULT false,
  had_suspension                  boolean NOT NULL DEFAULT false,
  warning_suspension_notes        text,
  had_abandonment_notice          boolean NOT NULL DEFAULT false, -- recebeu aviso de abandono de emprego
  -- NULL = não verificado ainda (default honesto — não presumir nem sim nem não).
  received_basic_basket_in_period boolean,
  basic_basket_notes              text, -- ex.: indício de falta que dá direito a receber, conforme regra interna
  union_engaged                   boolean NOT NULL DEFAULT false, -- acionou o sindicato
  union_notes                     text,
  created_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION whatsapp_hub._touch_legal_employee_context_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_case_employee_context_touch_updated_at ON whatsapp_hub.legal_case_employee_context;
CREATE TRIGGER legal_case_employee_context_touch_updated_at
  BEFORE UPDATE ON whatsapp_hub.legal_case_employee_context
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._touch_legal_employee_context_updated_at();

ALTER TABLE whatsapp_hub.legal_case_employee_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_case_employee_context_select ON whatsapp_hub.legal_case_employee_context
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

CREATE POLICY legal_case_employee_context_write ON whatsapp_hub.legal_case_employee_context
  FOR ALL TO authenticated
  USING (whatsapp_hub.can_access_legal())
  WITH CHECK (whatsapp_hub.can_access_legal());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.legal_case_employee_context TO authenticated;

-- ----------------------------------------------------------------------------
-- Painel — cruza legal_cases com o contexto de RH. LEFT JOIN: processo sem
-- contexto preenchido ainda não some da contagem geral, só não aparece nos
-- breakdowns que dependem do campo específico.
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
      FROM (SELECT status::text AS status, count(*) AS cnt FROM whatsapp_hub.legal_cases GROUP BY status) s
    ),
    'outcome_breakdown', (
      SELECT COALESCE(jsonb_object_agg(outcome, cnt), '{}'::jsonb)
      FROM (SELECT outcome::text AS outcome, count(*) AS cnt FROM whatsapp_hub.legal_cases WHERE outcome IS NOT NULL GROUP BY outcome) o
    ),
    'classification_ranking', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('classification', classification, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (SELECT classification, count(*) AS cnt FROM whatsapp_hub.legal_cases WHERE classification IS NOT NULL GROUP BY classification) c
    ),
    'instance_breakdown', (
      SELECT COALESCE(jsonb_object_agg(instance, cnt), '{}'::jsonb)
      FROM (SELECT instance::text AS instance, count(*) AS cnt FROM whatsapp_hub.legal_cases GROUP BY instance) i
    ),
    'year_breakdown', (
      SELECT COALESCE(jsonb_object_agg(yr, cnt), '{}'::jsonb)
      FROM (SELECT extract(year FROM created_at)::text AS yr, count(*) AS cnt FROM whatsapp_hub.legal_cases GROUP BY extract(year FROM created_at)) y
    ),
    'shift_breakdown', (
      SELECT COALESCE(jsonb_object_agg(shift, cnt), '{}'::jsonb)
      FROM (
        SELECT ec.shift AS shift, count(*) AS cnt
        FROM whatsapp_hub.legal_cases lc JOIN whatsapp_hub.legal_case_employee_context ec ON ec.case_id = lc.id
        WHERE ec.shift IS NOT NULL GROUP BY ec.shift
      ) sh
    ),
    'manager_ranking', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('manager', manager, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT ec.manager_name AS manager, count(*) AS cnt
        FROM whatsapp_hub.legal_cases lc JOIN whatsapp_hub.legal_case_employee_context ec ON ec.case_id = lc.id
        WHERE ec.manager_name IS NOT NULL GROUP BY ec.manager_name
      ) m
    ),
    'employee_department_breakdown', (
      SELECT COALESCE(jsonb_object_agg(department, cnt), '{}'::jsonb)
      FROM (
        SELECT ec.department AS department, count(*) AS cnt
        FROM whatsapp_hub.legal_cases lc JOIN whatsapp_hub.legal_case_employee_context ec ON ec.case_id = lc.id
        WHERE ec.department IS NOT NULL GROUP BY ec.department
      ) d
    ),
    'union_engaged_count', (
      SELECT count(*) FROM whatsapp_hub.legal_case_employee_context WHERE union_engaged
    ),
    'warning_or_suspension_count', (
      SELECT count(*) FROM whatsapp_hub.legal_case_employee_context WHERE had_written_warning OR had_suspension
    ),
    -- Indício de falta com direito a receber (regra interna citada pelo
    -- usuário): funcionário NÃO recebeu cesta básica no período (false, não
    -- NULL/não-verificado).
    'basic_basket_missing_count', (
      SELECT count(*) FROM whatsapp_hub.legal_case_employee_context WHERE received_basic_basket_in_period = false
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.legal_dashboard_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.legal_dashboard_stats() TO authenticated, service_role;
