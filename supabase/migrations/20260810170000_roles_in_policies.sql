-- Os quatro papeis entraram no enum, mas as policies continuaram escritas com
-- os dois antigos. Resultado: o dono da instalacao, que e super_admin, nao
-- escrevia em nenhuma das 41 tabelas pelo navegador, e supervisor tambem nao.
-- Passou despercebido porque quase tudo feito ate agora saiu por API Route com
-- service role, que ignora RLS.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Duas funcoes em vez de listas repetidas em cada policy: da proxima vez que um
-- papel entrar, muda-se um lugar.
CREATE OR REPLACE FUNCTION whatsapp_hub.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT whatsapp_hub.current_user_role() = ANY (ARRAY['super_admin','admin']);
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub.can_operate() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT whatsapp_hub.current_user_role()
         = ANY (ARRAY['super_admin','admin','supervisor','operator']);
$$;

GRANT EXECUTE ON FUNCTION whatsapp_hub.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.can_operate() TO authenticated;

-- Reescreve as policies existentes trocando as listas literais pelas funcoes.
-- Por varredura porque sao 42 espalhadas por 41 tabelas: reescrever a mao e
-- onde se esquece uma e ela vira o buraco.
--
-- A lista de alvos e materializada numa temp table antes de alterar qualquer
-- coisa. Iterar pg_policies enquanto se altera pg_policy nao aplica nada.
DO $rewrite$
declare
  r record;
  novo_qual text;
  novo_check text;
  cmd text;
  -- chr(39) em vez de aspas escapadas: dentro de dollar-quoting, '' sao dois
  -- caracteres literais, e foi assim que a primeira tentativa nao casou nada.
  q1 text := 'whatsapp_hub.current_user_role() = ANY (ARRAY[' || chr(39) || 'admin' || chr(39) || '::text, ' || chr(39) || 'operator' || chr(39) || '::text])';
  q2 text := 'whatsapp_hub.current_user_role() = ' || chr(39) || 'admin' || chr(39) || '::text';
  q3 text := 'whatsapp_hub.current_user_role() = ANY (ARRAY[' || chr(39) || 'super_admin' || chr(39) || '::text, ' || chr(39) || 'admin' || chr(39) || '::text])';
begin
  CREATE TEMP TABLE _pol ON COMMIT DROP AS
    SELECT tablename::text AS t, policyname::text AS p, qual::text AS q, with_check::text AS w
      FROM pg_policies
     WHERE schemaname = 'whatsapp_hub'
       AND (qual::text LIKE '%current_user_role() =%' OR with_check::text LIKE '%current_user_role() =%');

  for r in select * from _pol loop
    novo_qual  := coalesce(r.q, '');
    novo_check := coalesce(r.w, '');
    novo_qual  := replace(replace(replace(novo_qual,  q1, 'whatsapp_hub.can_operate()'), q3, 'whatsapp_hub.is_admin()'), q2, 'whatsapp_hub.is_admin()');
    novo_check := replace(replace(replace(novo_check, q1, 'whatsapp_hub.can_operate()'), q3, 'whatsapp_hub.is_admin()'), q2, 'whatsapp_hub.is_admin()');

    cmd := format('alter policy %I on whatsapp_hub.%I', r.p, r.t);
    if novo_qual <> '' then cmd := cmd || format(' using (%s)', novo_qual); end if;
    if novo_check <> '' then cmd := cmd || format(' with check (%s)', novo_check); end if;
    execute cmd;
  end loop;
end
$rewrite$;
