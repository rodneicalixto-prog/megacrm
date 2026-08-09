-- Hierarquia: dono vira super_admin, e o convite passa a carregar departamento.
--
-- Depende do enum criado em 20260808160000 (migration separada — ver o comentario
-- la sobre ADD VALUE em transacao) e dos departamentos de 20260808170000.

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. handle_new_user: aceita os quatro papeis e o departamento do convite
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_user_count   INT;
  v_invited_role TEXT;
  v_role         whatsapp_hub.tenant_role;
  v_department   UUID;
BEGIN
  SELECT COUNT(*) INTO v_user_count FROM whatsapp_hub.app_users;

  -- Departamento vem do convite; sem ele, o padrao.
  v_department := NULLIF(NEW.raw_user_meta_data->>'invited_department', '')::UUID;
  IF v_department IS NULL THEN
    SELECT id INTO v_department FROM whatsapp_hub.departments WHERE is_default LIMIT 1;
  END IF;

  -- Caso 0: primeiro usuario e o DONO. Antes virava admin; agora super_admin,
  -- que e o topo da hierarquia e o unico que ve a Administracao Geral.
  IF v_user_count = 0 THEN
    v_role := 'super_admin';

  -- Caso 1: convite nativo — invited_role gravado por inviteUserByEmail.
  ELSIF NEW.raw_user_meta_data ? 'invited_role'
        AND (NEW.raw_user_meta_data->>'invited_role')
            IN ('super_admin', 'admin', 'supervisor', 'operator') THEN
    v_invited_role := NEW.raw_user_meta_data->>'invited_role';
    v_role := v_invited_role::whatsapp_hub.tenant_role;

  -- Caso 2: sem convite valido — recusar self-signup.
  ELSE
    RAISE EXCEPTION 'Self-signup desabilitado. Solicite um convite ao owner desta instancia.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO whatsapp_hub.app_users (user_id, role, department_id, accepted_at)
  VALUES (NEW.id, v_role, v_department, now())
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', v_role::text)
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Promove o dono atual a super_admin — UMA VEZ
-- ----------------------------------------------------------------------------
-- O bootstrap pula migration ja marcada, entao isto roda uma vez so. A marca
-- em _bootstrap_state protege o caso de replay (restore, execucao manual):
-- sem ela, uma mudanca de papel feita depois seria revertida.
DO $$
DECLARE
  v_owner UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public._bootstrap_state WHERE step = 'hierarchy_owner_promoted') THEN
    RETURN;
  END IF;

  -- O dono e o admin mais antigo: quem criou a instalacao.
  SELECT user_id INTO v_owner
    FROM whatsapp_hub.app_users
   WHERE role = 'admin'
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_owner IS NOT NULL THEN
    UPDATE whatsapp_hub.app_users
       SET role = 'super_admin',
           department_id = (SELECT id FROM whatsapp_hub.departments
                             WHERE name = 'Administracao Geral' LIMIT 1)
     WHERE user_id = v_owner;

    -- Espelha no JWT. So vale na proxima renovacao de sessao — o token atual
    -- segue dizendo 'admin' ate expirar.
    UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', 'super_admin')
     WHERE id = v_owner;
  END IF;

  INSERT INTO public._bootstrap_state (step, completed_at, metadata)
  VALUES ('hierarchy_owner_promoted', now(), jsonb_build_object('user_id', v_owner));
END $$;

-- ----------------------------------------------------------------------------
-- 3. Helpers de RLS usados pelas policies da proxima fase
-- ----------------------------------------------------------------------------
-- STABLE: o Postgres avalia uma vez por query, nao por linha. Consultar
-- app_users por linha em `messages` seria o caminho mais curto para um inbox
-- lento.
CREATE OR REPLACE FUNCTION whatsapp_hub.current_user_department()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  SELECT department_id FROM whatsapp_hub.app_users WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub.department_is_restricted(p_department UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_restricted FROM whatsapp_hub.departments WHERE id = p_department), false);
$$;

-- Quem enxerga alem do proprio departamento.
CREATE OR REPLACE FUNCTION whatsapp_hub.sees_all_departments()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT whatsapp_hub.current_user_role() IN ('super_admin', 'admin');
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.current_user_department()          FROM anon;
REVOKE EXECUTE ON FUNCTION whatsapp_hub.department_is_restricted(UUID)     FROM anon;
