import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { getAdminClient, getAuthAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { canManageUser } from '../_shared/user-hierarchy.ts';
import type { CallerRole } from '../_shared/roles.ts';

const LONG_BAN = '876000h'; // 100 anos; reversível com `none`.

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Método não permitido.' }, { status: 405 });
  }

  try {
    const caller = await requireAdmin(req);
    const body = await req.json().catch(() => null) as { user_id?: string; active?: boolean } | null;
    const userId = (body?.user_id ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId) || typeof body?.active !== 'boolean') {
      return jsonResponse({ ok: false, error: 'Payload inválido.' }, { status: 400 });
    }
    if (userId === caller.userId) {
      return jsonResponse({ ok: false, error: 'Você não pode alterar o próprio acesso.' }, { status: 400 });
    }

    const db = getAdminClient();
    const { data: target, error: targetError } = await db
      .from('app_users')
      .select('role, is_active, is_online')
      .eq('user_id', userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      return jsonResponse({ ok: false, error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const targetRole = target.role as CallerRole;
    if (!caller.role || !canManageUser(caller.role, targetRole)) {
      return jsonResponse(
        { ok: false, error: 'Você só pode alterar usuários abaixo do seu nível hierárquico.' },
        { status: 403 },
      );
    }
    if (target.is_active === body.active) {
      return jsonResponse({ ok: true, user_id: userId, active: body.active });
    }

    // O ban impede novos logins/refreshes. O pre-request hook da migration e
    // requireCaller fecham também tokens que já estavam em circulação.
    const authAdmin = getAuthAdminClient();
    const { error: authError } = await authAdmin.auth.admin.updateUserById(userId, {
      ban_duration: body.active ? 'none' : LONG_BAN,
    });
    if (authError) {
      return jsonResponse({ ok: false, error: authError.message }, { status: authError.status ?? 400 });
    }

    const { error: updateError } = await db
      .from('app_users')
      .update({ is_active: body.active, is_online: body.active ? target.is_online : false })
      .eq('user_id', userId);
    if (updateError) {
      // Compensação best-effort para Auth e banco não divergirem.
      await authAdmin.auth.admin.updateUserById(userId, {
        ban_duration: body.active ? LONG_BAN : 'none',
      });
      throw updateError;
    }

    console.log(JSON.stringify({
      event: 'team_member_access_changed',
      actor_user_id: caller.userId,
      target_user_id: userId,
      target_role: targetRole,
      active: body.active,
    }));
    return jsonResponse({ ok: true, user_id: userId, active: body.active });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('set-team-member-active error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno.' },
      { status: 500 },
    );
  }
});
