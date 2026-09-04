-- Módulo Jurídico — linha do tempo de andamentos do tribunal.
--
-- 'manual' hoje (registro por quem acompanha o processo); 'trt_sync' pronto
-- pra quando existir integração real com TRT/PJe/DataJud — a Edge Function
-- de sincronização futura usa service role (bypassa RLS) e faz upsert por
-- external_ref, sem precisar de mudança de schema quando esse dia chegar.
SET search_path TO whatsapp_hub, public;

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_movement_source AS ENUM ('manual', 'trt_sync');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_court_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,
  description  text NOT NULL,
  source       whatsapp_hub.legal_movement_source NOT NULL DEFAULT 'manual',
  -- id do andamento no tribunal, só preenchido por source='trt_sync' —
  -- permite upsert idempotente quando a sincronização existir.
  external_ref text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_case_court_movements_case_idx ON whatsapp_hub.legal_case_court_movements (case_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS legal_case_court_movements_external_ref_uq
  ON whatsapp_hub.legal_case_court_movements (source, external_ref) WHERE external_ref IS NOT NULL;

ALTER TABLE whatsapp_hub.legal_case_court_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_case_court_movements_select ON whatsapp_hub.legal_case_court_movements
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

CREATE POLICY legal_case_court_movements_write ON whatsapp_hub.legal_case_court_movements
  FOR ALL TO authenticated
  USING (whatsapp_hub.can_access_legal())
  WITH CHECK (whatsapp_hub.can_access_legal());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.legal_case_court_movements TO authenticated;
