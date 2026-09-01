-- Aceite de convite de uso único. O link nativo do Supabase cria uma sessão,
-- mas essa sessão não deve permitir redefinir a senha repetidas vezes pela
-- tela /invite.

SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS invite_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_claim_id UUID,
  ADD COLUMN IF NOT EXISTS invite_claimed_at TIMESTAMPTZ;

-- Contas anteriores a esta regra já são contas estabelecidas, não convites
-- pendentes. Somente convites emitidos depois do deploy serão zerados pela
-- função invite-team-member.
UPDATE whatsapp_hub.app_users
   SET invite_accepted_at = COALESCE(accepted_at, created_at, now())
 WHERE invite_accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_pending_invite
  ON whatsapp_hub.app_users (user_id)
  WHERE invite_accepted_at IS NULL;

CREATE OR REPLACE FUNCTION whatsapp_hub.claim_team_invite(
  p_user_id UUID,
  p_claim_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  UPDATE whatsapp_hub.app_users
     SET invite_claim_id = p_claim_id,
         invite_claimed_at = now()
   WHERE user_id = p_user_id
     AND is_active = true
     AND invite_accepted_at IS NULL
     AND (
       invite_claim_id IS NULL
       OR invite_claimed_at < now() - interval '10 minutes'
     );
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.claim_team_invite(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.claim_team_invite(UUID, UUID) TO service_role;

-- Convites ainda não aceitos não ganham acesso ao PostgREST só porque o link
-- criou uma sessão Auth. O único caminho liberado é a Edge Function pública
-- para usuários autenticados accept-team-invite, que usa service_role.
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
       AND invite_accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Usuário desativado ou convite pendente.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
