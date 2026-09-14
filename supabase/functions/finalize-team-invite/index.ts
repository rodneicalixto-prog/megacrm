// ============================================================================
// finalize-team-invite
// ----------------------------------------------------------------------------
// Segunda metade do aceite de convite, separada de accept-team-invite
// (index.ts) de propósito: accept-team-invite consome o convite e devolve as
// linhas pessoais pendentes de QR, mas MANTÉM a sessão viva pra isso — o
// convidado precisa dela pra chamar /api/evolution-instance com o celular em
// mãos. Só depois que ele conecta (ou pula) o QR, o InvitePage chama esta
// função pra revogar globalmente a sessão nascida do link do e-mail (mesmo
// motivo do accept-team-invite original: copiar a URL do convite não deve
// reaproveitar o refresh token depois que a senha já foi definida).
// ============================================================================

import { getAuthAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Método não permitido.' }, { status: 405 });
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse({ ok: false, error: 'Sessão ausente.' }, { status: 401 });

  const authAdmin = getAuthAdminClient();
  const { data: authData, error: authError } = await authAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    // Sessão já revogada (chamada duplicada) — trata como sucesso, idempotente.
    return jsonResponse({ ok: true });
  }

  const { error: signOutError } = await authAdmin.auth.admin.signOut(token, 'global');
  if (signOutError) {
    console.error('finalize-team-invite signout error', signOutError);
    return jsonResponse({ ok: false, error: 'Não foi possível encerrar a sessão do convite.' }, { status: 500 });
  }

  return jsonResponse({ ok: true });
});
