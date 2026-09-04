-- Módulo Jurídico — anexos de processo.
--
-- Primeiro bucket PRIVADO do repositório: os buckets existentes
-- (whatsapp-hub-outbound-media etc.) são públicos porque a Evolution/Meta
-- precisa baixar mídia sem credencial. Documento jurídico é confidencial —
-- o frontend busca via `storage.from(...).createSignedUrl(path, ttl)` no
-- client autenticado; a policy de SELECT abaixo já protege o signed URL.
-- Upload é direto do client (sem Edge Function/service role) porque não há
-- efeito colateral externo, diferente de Reuniões (que chama o Google
-- Calendar antes de existir a linha).
SET search_path TO whatsapp_hub, public;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  -- Caminho dentro do bucket, ex.: {case_id}/{uuid}-{filename}.
  storage_path text NOT NULL,
  file_name    text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_case_attachments_case_idx ON whatsapp_hub.legal_case_attachments (case_id);

ALTER TABLE whatsapp_hub.legal_case_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_case_attachments_select ON whatsapp_hub.legal_case_attachments
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

CREATE POLICY legal_case_attachments_write ON whatsapp_hub.legal_case_attachments
  FOR ALL TO authenticated
  USING (whatsapp_hub.can_access_legal())
  WITH CHECK (whatsapp_hub.can_access_legal());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_hub.legal_case_attachments TO authenticated;

-- Bucket privado. Sem allowed_mime_types (mesmo padrão dos buckets
-- existentes, que também não restringem por mime).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-hub-legal-attachments', 'whatsapp-hub-legal-attachments', false, 25 * 1024 * 1024)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS wh_legal_attachments_read   ON storage.objects;
DROP POLICY IF EXISTS wh_legal_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS wh_legal_attachments_delete ON storage.objects;

CREATE POLICY wh_legal_attachments_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'whatsapp-hub-legal-attachments'
    AND whatsapp_hub.can_access_legal()
  );

CREATE POLICY wh_legal_attachments_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-hub-legal-attachments'
    AND whatsapp_hub.can_access_legal()
  );

CREATE POLICY wh_legal_attachments_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-hub-legal-attachments'
    AND whatsapp_hub.can_access_legal()
  );
