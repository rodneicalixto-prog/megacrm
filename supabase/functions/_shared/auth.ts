// Resolve the caller's identity from the Authorization header. We let
// Supabase's auth.getUser() do the JWT signature + expiry verification so we
// don't need to ship the JWT secret into the Edge Function.
//
// In the self-hosted single-org build the only claim that matters is `role`.
// Edge Functions running with service_role bypass RLS regardless, so the
// caller object is mostly used for human-vs-human authorization (admin gates).

import { getAdminClient, getAuthAdminClient } from './supabase-admin.ts';

import { ADMIN_ROLES, type CallerRole } from './roles.ts';
export { ADMIN_ROLES, type CallerRole } from './roles.ts';
export interface Caller {
  userId: string;
  email: string | null;
  role: CallerRole | null;
}


export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new AuthError('Missing Authorization header');
  }

  const admin = getAuthAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError('Invalid token');
  }

  const appMeta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const role = typeof appMeta.role === 'string' ? appMeta.role : null;

  // Não basta banir no Auth: um access token já emitido pode continuar válido
  // até expirar. Toda Edge Function confirma o estado atual da conta.
  const { data: member, error: memberError } = await getAdminClient()
    .from('app_users')
    .select('is_active')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (memberError || !member || member.is_active !== true) {
    throw new AuthError('Usuário desativado', 403);
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    role: (role as Caller['role']) ?? null,
  };
}

export async function requireAdmin(req: Request): Promise<Caller> {
  const caller = await requireCaller(req);
  if (!caller.role || !ADMIN_ROLES.includes(caller.role)) {
    throw new AuthError('Admin role required', 403);
  }
  return caller;
}

// Gate do supervisor: administra o proprio departamento. Admin e super_admin
// passam por cima, como em qualquer nivel abaixo deles.
export async function requireSupervisor(req: Request): Promise<Caller> {
  const caller = await requireCaller(req);
  if (!caller.role || ![...ADMIN_ROLES, 'supervisor'].includes(caller.role)) {
    throw new AuthError('Supervisor role required', 403);
  }
  return caller;
}

// Gate para funções acionadas por pg_cron / triggers pg_net, que NÃO carregam
// um JWT de usuário — elas se autenticam com a service role key (seedada nas
// Vault entries `whatsapp_hub_service_role_key`).
//
// Aceita o token se ele bater com (a) o SUPABASE_SERVICE_ROLE_KEY injetado na
// função OU (b) o segredo da Vault usado pelo cron — validado server-side pela
// RPC verify_service_token. O fallback existe porque o valor da Vault (definido
// no setup) pode divergir do SUPABASE_SERVICE_ROLE_KEY injetado quando o projeto
// usa o novo formato de API keys; sem isso, todo invoke pg_net dá 403.
export async function requireServiceRole(req: Request): Promise<void> {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AuthError('Forbidden', 403);
  if (expected && constantTimeEqual(token, expected)) return;
  try {
    const { data, error } = await getAdminClient().rpc('verify_service_token', { p_token: token });
    if (!error && data === true) return;
  } catch {
    // cai no throw abaixo
  }
  throw new AuthError('Forbidden', 403);
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
