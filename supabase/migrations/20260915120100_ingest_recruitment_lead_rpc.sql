-- ============================================================================
-- RPC de ingestão de candidato de vaga (recrutamento)
-- ----------------------------------------------------------------------------
-- Espelha whatsapp_hub.ingest_landing_lead, mas em vez de sempre usar o
-- pipeline kind='comercial', usa o pipeline dedicado name='Recrutamento'
-- (criado em 20260915120000_recruitment_pipeline.sql). Assim candidatos de
-- vaga nunca se misturam com leads comerciais reais.
-- ============================================================================

SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub.ingest_recruitment_lead(
  p_contact_id UUID,
  p_vaga       TEXT DEFAULT NULL,
  p_raw        JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_deal     UUID;
  v_pipeline UUID;
  v_stage    UUID;
  v_title    TEXT;
BEGIN
  SELECT id INTO v_pipeline
  FROM whatsapp_hub.pipelines WHERE name = 'Recrutamento'
  ORDER BY position, created_at LIMIT 1;

  IF v_pipeline IS NULL THEN
    RAISE EXCEPTION 'Pipeline "Recrutamento" não existe. Rode a migration 20260915120000_recruitment_pipeline.sql antes desta.';
  END IF;

  SELECT id INTO v_deal
  FROM whatsapp_hub.deals
  WHERE contact_id = p_contact_id AND pipeline_id = v_pipeline AND status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_deal IS NULL THEN
    SELECT id INTO v_stage
    FROM whatsapp_hub.stages
    WHERE pipeline_id = v_pipeline AND NOT is_won AND NOT is_lost
    ORDER BY position LIMIT 1;

    SELECT COALESCE(NULLIF(btrim(name), ''), phone, email, 'Candidato')
    INTO v_title FROM whatsapp_hub.contacts WHERE id = p_contact_id;

    INSERT INTO whatsapp_hub.deals (
      contact_id, pipeline_id, stage_id, title, status,
      attribution_method, raw_tracking
    ) VALUES (
      p_contact_id, v_pipeline, v_stage,
      CASE WHEN p_vaga IS NOT NULL THEN v_title || ' — ' || p_vaga ELSE v_title END,
      'open', 'recrutamento_whatsapp', p_raw
    )
    RETURNING id INTO v_deal;
  ELSE
    UPDATE whatsapp_hub.deals SET
      raw_tracking = COALESCE(p_raw, raw_tracking)
    WHERE id = v_deal;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'deal_id', v_deal,
      'pipeline_id', v_pipeline,
      'stage_id', d.stage_id
    )
    FROM whatsapp_hub.deals d WHERE d.id = v_deal
  );
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.ingest_recruitment_lead(UUID, TEXT, JSONB) FROM PUBLIC;
