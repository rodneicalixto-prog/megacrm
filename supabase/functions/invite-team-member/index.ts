// ============================================================================
// invite-team-member
// ----------------------------------------------------------------------------
// Admin sends an email + role. We relay to Supabase Auth's inviteUserByEmail,
// encoding the target role into user_metadata. The `handle_new_user` trigger
// reads `invited_role` and provisions the new user accordingly.
//
// Self-hosted single-org build: there is no tenant to attach to. The role
// alone is what the trigger needs.
//
// Only `admin` callers may invite. Email is normalized to lowercase.
// ============================================================================

import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { getAdminClient, getAuthAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

type Role = 'super_admin' | 'admin' | 'supervisor' | 'operator';

const ROLES = new Set<Role>(['super_admin', 'admin', 'supervisor', 'operator']);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireAdmin(req);

    let body: {
      email?: string;
      role?: Role;
      app_url?: string;
      department_id?: string;
      position_name?: string;
      instance?: string;
      server_url?: string;
      api_key?: string;
    };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const role = body.role as Role | undefined;
    const department_id = (body.department_id ?? '').trim() || null;
    // Linha pessoal do convidado (Módulo "Evolution multi-número"): opcional,
    // só faz sentido para supervisor/operador. O QR de pareamento NÃO é
    // gerado aqui — o admin não tem o celular da pessoa em mãos. Só criamos
    // o cargo + a linha "a conectar"; accept-team-invite mostra o QR para o
    // próprio convidado, no momento em que ele define a senha.
    const positionName = (body.position_name ?? '').trim() || null;
    const instance = (body.instance ?? '').trim() || null;
    const serverUrl = (body.server_url ?? '').trim() || null;
    const apiKey = (body.api_key ?? '').trim() || null;

    // Regex mais estrita: bloqueia HTML/JS na parte local e exige TLD com 2+ chars.
    if (!email || email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      return jsonResponse({ ok: false, error: 'E-mail inválido.' }, { status: 400 });
    }
    if (!role || !ROLES.has(role)) {
      return jsonResponse({ ok: false, error: 'role inválido.' }, { status: 400 });
    }
    if ((positionName || instance) && !(positionName && instance)) {
      return jsonResponse(
        { ok: false, error: 'Informe o cargo e a instância da linha juntos, ou deixe os dois em branco.' },
        { status: 400 },
      );
    }
    if (positionName && instance && !department_id) {
      return jsonResponse(
        { ok: false, error: 'Selecione um setor específico para cadastrar cargo e linha (não use o padrão).' },
        { status: 400 },
      );
    }
    // Só o topo cria outro topo. Sem isto um admin escalaria o próprio nível
    // convidando um super_admin e entrando com ele.
    if (role === 'super_admin' && caller.role !== 'super_admin') {
      return jsonResponse(
        { ok: false, error: 'Apenas o super admin pode convidar outro super admin.' },
        { status: 403 },
      );
    }

    const admin = getAuthAdminClient();

    // redirectTo aponta o link do e-mail de convite (gerado pelo Supabase) para
    // a tela /invite, onde o convidado define a senha. Prioridade:
    //   1. credencial `app_url` (URL de produção registrada no setup);
    //   2. `app_url` enviado pelo frontend (window.location.origin) — garante
    //      que o link vá para o domínio real onde o app está rodando (Vercel),
    //      nunca localhost, mesmo sem a credencial configurada;
    //   3. sem nada válido: cai no Site URL do projeto Supabase.
    const isValidAppUrl = (u: string) => /^https:\/\/[^\s/]+\.[^\s/]+/.test(u);
    const credUrl = (await getCredential('app_url'))?.replace(/\/$/, '') || '';
    const bodyUrl = (body.app_url ?? '').trim().replace(/\/$/, '');
    const appUrl = credUrl || (isValidAppUrl(bodyUrl) ? bodyUrl : '');
    const redirectTo = appUrl ? `${appUrl}/invite` : undefined;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        invited_role: role,
        // Departamento do convidado; o trigger cai no padrao se vier vazio.
        ...(department_id ? { invited_department: department_id } : {}),
        invited_by: caller.email,
      },
      ...(redirectTo ? { redirectTo } : {}),
    });

    if (error) {
      // Traduz mensagens comuns do gotrue (que vêm em inglês) pra manter a UI
      // consistente em pt-BR. Caímos no fallback do error.message original
      // quando a mensagem não bate com nenhum padrão conhecido.
      const raw = error.message ?? '';
      let userMessage = raw;
      if (/invalid email|invalid format|Email address.*invalid/i.test(raw)) {
        userMessage = 'E-mail inválido ou domínio não suportado pelo provedor de auth.';
      } else if (/already.*registered|User already registered/i.test(raw)) {
        userMessage = 'Já existe um usuário com esse e-mail.';
      } else if (/rate limit/i.test(raw)) {
        userMessage = 'Muitos convites em sequência. Aguarde alguns minutos e tente de novo.';
      }
      return jsonResponse(
        { ok: false, error: userMessage },
        { status: error.status ?? 400 },
      );
    }

    if (!data.user?.id) {
      return jsonResponse({ ok: false, error: 'O provedor não retornou o usuário convidado.' }, { status: 502 });
    }

    // O trigger cria app_users no momento do inviteUserByEmail. Marcamos esta
    // conta como pendente para que apenas accept-team-invite possa definir a
    // senha, exatamente uma vez.
    const { error: pendingError } = await getAdminClient()
      .from('app_users')
      .update({ invite_accepted_at: null, invite_claim_id: null, invite_claimed_at: null })
      .eq('user_id', data.user.id);
    if (pendingError) {
      // Não deixa uma conta convidada sem a proteção one-shot.
      await admin.auth.admin.deleteUser(data.user.id);
      throw pendingError;
    }

    // Cargo + linha pessoal, só para supervisor/operator com os dois campos
    // preenchidos. Falha em qualquer etapa desfaz tudo (cargo, linha e o
    // próprio convite) — nunca deixa um convite "pela metade" (setor sem
    // número, ou número sem dono), que foi exatamente o buraco encontrado no
    // departamento Recrutamento Humano.
    let positionId: string | null = null;
    if ((role === 'supervisor' || role === 'operator') && positionName && instance) {
      try {
        const { data: position, error: positionError } = await getAdminClient()
          .from('department_positions')
          .insert({
            department_id: department_id,
            name: positionName,
            user_id: data.user.id,
          })
          .select('id')
          .single();
        if (positionError || !position) throw positionError ?? new Error('Falha ao criar o cargo.');
        positionId = position.id as string;

        if (!appUrl) {
          throw new Error(
            'Não foi possível determinar a URL do app para cadastrar a linha. Configure a credencial app_url em Configurações.',
          );
        }
        const connRes = await fetch(`${appUrl}/api/department-connections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Repassa o token de quem chamou este convite (já validado como
            // admin/super_admin por requireAdmin acima) — a rota de conexões
            // tem sua própria checagem de admin, e usar o mesmo token evita
            // duplicar essa lógica aqui.
            Authorization: req.headers.get('Authorization') ?? '',
          },
          body: JSON.stringify({
            departmentId: department_id,
            positionId,
            instance,
            label: positionName,
            ...(serverUrl ? { serverUrl } : {}),
            ...(apiKey ? { apiKey } : {}),
          }),
        });
        const connBody = await connRes.json().catch(() => ({}));
        if (!connRes.ok || !connBody?.success) {
          throw new Error(connBody?.message ?? 'Falha ao cadastrar a linha do convidado.');
        }
      } catch (provisionError) {
        if (positionId) {
          await getAdminClient().from('department_positions').delete().eq('id', positionId);
        }
        await admin.auth.admin.deleteUser(data.user.id);
        return jsonResponse(
          {
            ok: false,
            error: provisionError instanceof Error
              ? provisionError.message
              : 'Não foi possível provisionar o cargo/linha do convidado.',
          },
          { status: 400 },
        );
      }
    }

    return jsonResponse({
      ok: true,
      user_id: data.user.id,
      email,
      role,
      position_id: positionId,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('invite-team-member error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
