-- Identidade visual da instalacao: nome da empresa e logo.
--
-- O white-label foi removido na migracao SaaS -> OSS porque servia a varios
-- clientes numa instalacao so. Volta com outro proposito: aqui e UMA empresa, e
-- ela precisa se ver no proprio CRM. Nao ha tema por cliente nem cor dinamica —
-- o dark glassmorphism continua fixo. Sao dois campos.
--
-- A logo vive em bucket em vez de coluna: arquivo binario em Postgres inflaria
-- o singleton que o app le em toda carga de pagina.

SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.app_settings
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS logo_url     TEXT;

-- Publico: a logo aparece antes do login (tela de entrada e de convite).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-hub-branding', 'whatsapp-hub-branding', true, 2 * 1024 * 1024)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS wh_branding_read   ON storage.objects;
DROP POLICY IF EXISTS wh_branding_write  ON storage.objects;
DROP POLICY IF EXISTS wh_branding_delete ON storage.objects;

CREATE POLICY wh_branding_read
  ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'whatsapp-hub-branding');

CREATE POLICY wh_branding_write
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-hub-branding'
    AND whatsapp_hub.current_user_role() IN ('super_admin', 'admin')
  );

CREATE POLICY wh_branding_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-hub-branding'
    AND whatsapp_hub.current_user_role() IN ('super_admin', 'admin')
  );
