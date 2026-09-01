import { getAdminClient, getAuthAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

const UUID_RE = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Método não permitido.' }, { status: 405 });
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse({ ok: false, error: 'Convite inválido.' }, { status: 401 });

  const authAdmin = getAuthAdminClient();
  const { data: authData, error: authError } = await authAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return jsonResponse({ ok: false, error: 'Convite inválido ou expirado.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { password?: string } | null;
  const password = body?.password ?? '';
  if (password.length < 8 || password.length > 128) {
    return jsonResponse({ ok: false, error: 'A senha deve ter entre 8 e 128 caracteres.' }, { status: 400 });
  }

  const claimId = crypto.randomUUID();
  if (!UUID_RE.test(claimId)) throw new Error('Falha ao criar claim do convite.');
  const db = getAdminClient();

  // UPDATE condicional funciona como compare-and-swap: duas tentativas
  // concorrentes não conseguem consumir o mesmo convite.
  const { data: claimed, error: claimError } = await db.rpc('claim_team_invite', {
    p_user_id: authData.user.id,
    p_claim_id: claimId,
  });

  if (claimError) {
    return jsonResponse({ ok: false, error: claimError.message }, { status: 500 });
  }
  if (claimed !== true) {
    return jsonResponse(
      { ok: false, error: 'Este convite já foi utilizado, cancelado ou está sendo processado.' },
      { status: 409 },
    );
  }

  const { error: passwordError } = await authAdmin.auth.admin.updateUserById(authData.user.id, {
    password,
    email_confirm: true,
  });
  if (passwordError) {
    await db.from('app_users')
      .update({ invite_claim_id: null, invite_claimed_at: null })
      .eq('user_id', authData.user.id)
      .eq('invite_claim_id', claimId);
    return jsonResponse({ ok: false, error: passwordError.message }, { status: passwordError.status ?? 400 });
  }

  const { data: consumed, error: consumeError } = await db
    .from('app_users')
    .update({
      invite_accepted_at: new Date().toISOString(),
      invite_claim_id: null,
      invite_claimed_at: null,
      accepted_at: new Date().toISOString(),
    })
    .eq('user_id', authData.user.id)
    .eq('invite_claim_id', claimId)
    .is('invite_accepted_at', null)
    .select('user_id')
    .maybeSingle();
  if (consumeError || !consumed) {
    console.error('accept-team-invite consume error', consumeError);
    return jsonResponse({ ok: false, error: 'Não foi possível finalizar o aceite do convite.' }, { status: 500 });
  }

  // Revoga a sessão criada pelo link. O usuário entra novamente com a senha
  // recém-definida; copiar a URL redirecionada não reaproveita o refresh token.
  const { error: signOutError } = await authAdmin.auth.admin.signOut(token, 'global');
  if (signOutError) {
    console.error('accept-team-invite signout error', signOutError);
  }

  console.log(JSON.stringify({ event: 'team_invite_consumed', user_id: authData.user.id }));
  return jsonResponse({ ok: true });
});
