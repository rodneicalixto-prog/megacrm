-- Administradores podem suspender contas abaixo deles na hierarquia sem
-- apagar histórico, atribuições ou o usuário do Supabase Auth.

SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_app_users_active
  ON whatsapp_hub.app_users (is_active, role);

-- PostgREST executa este hook antes de cada request. Isso fecha imediatamente
-- o acesso direto ao banco mesmo enquanto o JWT emitido antes da suspensão
-- ainda não expirou. Requests anon/service_role não representam um app_user e
-- continuam funcionando normalmente.
CREATE OR REPLACE FUNCTION whatsapp_hub.check_active_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM whatsapp_hub.app_users
     WHERE user_id = auth.uid()
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Usuário desativado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.check_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_hub.check_active_user() TO anon, authenticated, service_role;

DO $$
BEGIN
  EXECUTE 'ALTER ROLE authenticator SET pgrst.db_pre_request = ''whatsapp_hub.check_active_user''';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Sem permissão para configurar pgrst.db_pre_request; configure whatsapp_hub.check_active_user manualmente.';
END $$;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
