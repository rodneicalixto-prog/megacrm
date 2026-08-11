-- Aplica em bancos ja migrados o hardening introduzido no cadastro de usuarios.
-- As migrations 20260810120000 e 20260810210000 ja estavam marcadas como
-- aplicadas em producao, portanto alterar apenas os arquivos historicos nao
-- atualizaria a funcao remota.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_intervalo;
ALTER TABLE whatsapp_hub.calendar_events
  ADD CONSTRAINT calendar_events_intervalo CHECK (ends_at > starts_at);

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
  v_position_department_id uuid;
  v_position_user_id uuid;
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

  -- A UI filtra cargos livres do setor, mas a RPC tambem e uma API publica para
  -- authenticated. A validacao e o lock aqui impedem payload adulterado e a
  -- corrida de dois admins ocupando o mesmo cargo ao mesmo tempo.
  if p_position_id is not null then
    select department_id, user_id
      into v_position_department_id, v_position_user_id
      from whatsapp_hub.department_positions
     where id = p_position_id
       for update;

    if not found then
      raise exception 'Cargo nao encontrado.';
    end if;
    if v_position_user_id is not null then
      raise exception 'Este cargo ja esta vinculado a outra pessoa.';
    end if;
    if p_department_id is not null and p_department_id <> v_position_department_id then
      raise exception 'O cargo nao pertence ao setor informado.';
    end if;
  elsif p_department_id is null then
    raise exception 'Informe o setor.';
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
           v_position_department_id,
           p_department_id,
           department_id
         )
   where user_id = v_uid;

  if p_position_id is not null then
    update whatsapp_hub.department_positions
       set user_id = v_uid
     where id = p_position_id;

    if not found then
      raise exception 'Nao foi possivel vincular o cargo.';
    end if;
  end if;

  return jsonb_build_object('user_id', v_uid, 'email', v_email, 'nome', v_nome);
end;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.create_user(text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.create_user(text, text, text, uuid, uuid) TO authenticated;
