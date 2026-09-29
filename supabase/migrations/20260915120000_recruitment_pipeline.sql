-- ============================================================================
-- Pipeline dedicado de Recrutamento
-- ----------------------------------------------------------------------------
-- Evita que candidatos de vaga (fluxo n8n "RH — Triagem de Candidatos")
-- caiam misturados no funil Comercial via ingest-lead. O enum
-- whatsapp_hub.crm_pipeline_kind não tem opção de RH, então usamos 'projeto'
-- como kind e distinguimos pelo name = 'Recrutamento'.
-- Idempotente: só cria se ainda não existir um pipeline com esse nome.
-- ============================================================================

SET search_path TO whatsapp_hub, public;

DO $$
DECLARE
  v_pipeline_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_hub.pipelines WHERE name = 'Recrutamento'
  ) THEN
    INSERT INTO whatsapp_hub.pipelines (name, kind, position)
    VALUES (
      'Recrutamento',
      'projeto',
      (SELECT COALESCE(MAX(position), 0) + 1 FROM whatsapp_hub.pipelines)
    )
    RETURNING id INTO v_pipeline_id;

    INSERT INTO whatsapp_hub.stages (pipeline_id, name, position, is_won, is_lost) VALUES
      (v_pipeline_id, 'Triagem',             0, false, false),
      (v_pipeline_id, 'Formulário enviado',  1, false, false),
      (v_pipeline_id, 'Entrevista agendada', 2, false, false),
      (v_pipeline_id, 'Aprovado',            3, true,  false),
      (v_pipeline_id, 'Reprovado',           4, false, true);
  END IF;
END $$;
