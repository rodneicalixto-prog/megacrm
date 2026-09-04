-- Módulo Jurídico — painel de inteligência.
--
-- Sem tabela nova pros números: volume, desfecho e ranking por causa são
-- agregações baratas sobre legal_cases (baixa cardinalidade esperada pra um
-- módulo jurídico, não milhões de linhas) — uma view materializada seria
-- over-engineering, e não há precedente de CREATE VIEW pra BI no resto do
-- repositório. RPC única devolvendo jsonb, chamável direto do frontend via
-- supabase.rpc(...), sem round-trip de Edge Function.
--
-- "Plano de ação de prevenção" fica no frontend (mapa classification →
-- texto sugerido) — só vira tabela se um dia o admin precisar editar isso
-- sem deploy, o que não foi pedido nesta rodada.
SET search_path TO whatsapp_hub, public;

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
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.legal_dashboard_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.legal_dashboard_stats() TO authenticated, service_role;
