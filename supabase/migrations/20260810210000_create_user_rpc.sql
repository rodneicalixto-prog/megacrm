-- Cadastro de usuario pela tela: nome, e-mail, funcao, setor e cargo.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Nome do usuario. Ate aqui a unica identificacao era o e-mail, e numa lista de
-- dezessete contas com sufixo +cargo o e-mail nao diz quem e a pessoa.
ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS full_name text;

UPDATE whatsapp_hub.app_users au
SET full_name = coalesce(au.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'cargo')
FROM auth.users u
WHERE u.id = au.user_id AND au.full_name IS NULL;

-- SECURITY DEFINER porque escrever em auth.users exige privilegio que o
-- authenticated nao tem — e por isso a primeira coisa que ela faz e conferir
-- que quem chamou e admin. Sem essa checagem, a funcao seria uma porta para
-- qualquer usuario logado criar um super_admin.
--
-- Nao define senha: a pessoa cria a dela por "Esqueci minha senha". E o mesmo
-- caminho usado nas dezessete contas iniciais, e evita senha compartilhada
-- circulando por e-mail ou papel.
CREATE OR REPLACE FUNCTION whatsapp_hub.create_user(
  p_nome text,
  p_email text,
  p_funcao text,
  p_department_id uuid DEFAULT NULL,
  p_position_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, auth, pg_temp
AS $$
declare
  v_uid uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
  v_nome text := trim(coalesce(p_nome, ''));
begin
  if not whatsapp_hub.is_admin() then
    raise exception 'Apenas admin pode cadastrar usuarios.';
  end if;
  if v_nome = '' then
    raise exception 'Informe o nome.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail invalido.';
  end if;
  if p_funcao not in ('admin','supervisor','operator') then
    -- super_admin de proposito fora da lista: e o dono da instalacao, criado
    -- uma vez no bootstrap, nao algo que se cadastra por formulario.
    raise exception 'Funcao invalida.';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Ja existe um usuario com esse e-mail.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, invited_at, confirmation_token, recovery_token,
    email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, null,
    null, now(), '', '', '', '',
    jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    jsonb_build_object('invited_role', p_funcao, 'full_name', v_nome),
    now(), now(), false, false
  );

  -- A identity de provider 'email' e o que faz a recuperacao de senha funcionar.
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', false),
    'email', v_uid::text, now(), now()
  );

  -- handle_new_user ja criou a linha em app_users a partir do invited_role.
  update whatsapp_hub.app_users
     set full_name = v_nome,
         department_id = coalesce(
           p_department_id,
           (select department_id from whatsapp_hub.department_positions where id = p_position_id),
           department_id
         )
   where user_id = v_uid;

  if p_position_id is not null then
    update whatsapp_hub.department_positions
       set user_id = v_uid
     where id = p_position_id;
  end if;

  return jsonb_build_object('user_id', v_uid, 'email', v_email, 'nome', v_nome);
end;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.create_user(text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.create_user(text, text, text, uuid, uuid) TO authenticated;

-- A lista de pessoas devolvia so o e-mail. Com contas em sufixo +cargo na mesma
-- caixa, o e-mail nao identifica ninguem.
DROP FUNCTION IF EXISTS whatsapp_hub.list_operators();

CREATE OR REPLACE FUNCTION whatsapp_hub.list_operators()
RETURNS TABLE(user_id uuid, email text, role whatsapp_hub.tenant_role,
              full_name text, department_id uuid, department_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'auth', 'public', 'pg_temp'
AS $$
  SELECT au.user_id, u.email::text, au.role,
         coalesce(nullif(au.full_name, ''), u.raw_user_meta_data->>'full_name') AS full_name,
         au.department_id, d.name AS department_name
    FROM whatsapp_hub.app_users au
    JOIN auth.users u ON u.id = au.user_id
    LEFT JOIN whatsapp_hub.departments d ON d.id = au.department_id
   ORDER BY au.role, coalesce(nullif(au.full_name, ''), u.email::text);
$$;

GRANT EXECUTE ON FUNCTION whatsapp_hub.list_operators() TO authenticated;

UPDATE whatsapp_hub.app_users au
SET full_name = coalesce(nullif(au.full_name,''), u.raw_user_meta_data->>'cargo')
FROM auth.users u
WHERE u.id = au.user_id AND coalesce(au.full_name,'') = '';
