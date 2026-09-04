-- Módulo Jurídico — testemunhas e prepostos por processo.
SET search_path TO whatsapp_hub, public;

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_case_side AS ENUM ('empresa', 'reclamante');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_witnesses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- Ex.: "Preposto", "Testemunha — Analista Financeiro".
  role_label text,
  side       whatsapp_hub.legal_case_side NOT NULL,
  status     text NOT NULL DEFAULT 'a_confirmar',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_case_witnesses_case_idx ON whatsapp_hub.legal_case_witnesses (case_id);

ALTER TABLE whatsapp_hub.legal_case_witnesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_case_witnesses_select ON whatsapp_hub.legal_case_witnesses
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

CREATE POLICY legal_case_witnesses_write ON whatsapp_hub.legal_case_witnesses
  FOR ALL TO authenticated
  USING (whatsapp_hub.can_access_legal())
  WITH CHECK (whatsapp_hub.can_access_legal());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.legal_case_witnesses TO authenticated;
