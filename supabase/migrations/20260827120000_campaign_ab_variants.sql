-- Onda 3, parte 2 do pacote de atualização (PLANEJAMENTO.md): teste A/B de
-- templates em campanhas — dispara variantes diferentes e compara performance.
--
-- Reaproveita o mecanismo que já existe para follow-ups:
-- campaign_contacts.template_id_override já faz o dispatch-campaign
-- (supabase/functions/dispatch-campaign/index.ts) agrupar e enviar por
-- template efetivo (template_id_override ?? campaigns.template_id) — uma
-- campanha A/B só precisa popular esse campo por sorteio ponderado na
-- criação da fila, sem tocar no dispatcher.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

CREATE TABLE IF NOT EXISTS whatsapp_hub.campaign_variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES whatsapp_hub.campaigns(id) ON DELETE CASCADE,
  template_id  UUID NOT NULL REFERENCES whatsapp_hub.templates(id) ON DELETE RESTRICT,
  -- Peso relativo do sorteio (não precisa somar 100 — é normalizado no client).
  weight       INT NOT NULL DEFAULT 1 CHECK (weight > 0),
  sent         INT NOT NULL DEFAULT 0,
  delivered    INT NOT NULL DEFAULT 0,
  read         INT NOT NULL DEFAULT 0,
  replied      INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_variants_campaign ON whatsapp_hub.campaign_variants(campaign_id);

ALTER TABLE whatsapp_hub.campaign_contacts
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES whatsapp_hub.campaign_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_variant
  ON whatsapp_hub.campaign_contacts(variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE whatsapp_hub.campaign_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_variants_select ON whatsapp_hub.campaign_variants;
CREATE POLICY campaign_variants_select ON whatsapp_hub.campaign_variants
  FOR SELECT TO authenticated USING (true);

-- Mesmo recorte de campaigns_admin_write/campaign_contacts_admin_write —
-- campanhas são admin-only para escrita.
DROP POLICY IF EXISTS campaign_variants_admin_write ON whatsapp_hub.campaign_variants;
CREATE POLICY campaign_variants_admin_write ON whatsapp_hub.campaign_variants
  FOR ALL TO authenticated
  USING      (whatsapp_hub.is_admin())
  WITH CHECK (whatsapp_hub.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.campaign_variants TO authenticated;

-- Incrementa os contadores por variante em paralelo aos contadores agregados
-- da campanha (bump_campaign_counter, já existente) — chamada pelos mesmos
-- pontos que hoje só atualizam a campanha: sync-broadcast-status e
-- zernio-webhook, quando a linha de campaign_contacts tem variant_id.
CREATE OR REPLACE FUNCTION whatsapp_hub.bump_campaign_variant_counter(
  p_variant_id UUID,
  p_column TEXT,
  p_delta INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub
AS $$
BEGIN
  IF p_variant_id IS NULL THEN
    RETURN;
  END IF;
  IF p_column NOT IN ('sent', 'delivered', 'read', 'replied', 'failed') THEN
    RAISE EXCEPTION 'invalid counter column %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE whatsapp_hub.campaign_variants SET %I = GREATEST(COALESCE(%I, 0) + $1, 0) WHERE id = $2',
    p_column, p_column
  ) USING p_delta, p_variant_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.bump_campaign_variant_counter(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.bump_campaign_variant_counter(UUID, TEXT, INT) TO authenticated, service_role;
