// Admin gate compartilhado pelas Vercel API Routes (api/credentials,
// api/zernio-connect). Esses endpoints rodam com a service role, entao sem esse
// check qualquer um poderia ler/escrever o cofre de credenciais. O owner criado
// no /setup carrega app_metadata.role = 'admin' (espelhado no JWT).

import { createClient } from '@supabase/supabase-js';

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase core nao configurado.');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function requireAdmin(
  authHeader: string | string[] | undefined,
): Promise<AdminAuthResult> {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Sessao ausente.' };

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, message: 'Sessao invalida ou expirada.' };
  }
  const role = (data.user.app_metadata as { role?: string } | null)?.role;
  if (role !== 'admin' && role !== 'super_admin') {
    return { ok: false, status: 403, message: 'Acesso restrito a administradores.' };
  }
  return { ok: true, userId: data.user.id };
}

// Mesma checagem de sessão de requireAdmin, mas também deixa passar o
// próprio dono da linha (department_positions.user_id) conectando o seu QR —
// é o caso do InvitePage logo depois do aceite do convite, quando a pessoa
// ainda não tem role admin/super_admin e é exatamente quem tem o celular em
// mãos pra escanear.
export async function requireAdminOrLineOwner(
  authHeader: string | string[] | undefined,
  connectionId: string,
): Promise<AdminAuthResult> {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Sessao ausente.' };

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, message: 'Sessao invalida ou expirada.' };
  }
  const role = (data.user.app_metadata as { role?: string } | null)?.role;
  if (role === 'admin' || role === 'super_admin') {
    return { ok: true, userId: data.user.id };
  }

  const { data: connection, error: connError } = await admin
    .schema('whatsapp_hub')
    .from('department_connections')
    .select('id, department_positions!inner(user_id)')
    .eq('id', connectionId)
    .maybeSingle();
  if (connError || !connection) {
    return { ok: false, status: 404, message: 'Linha não encontrada.' };
  }
  const positions = (connection as { department_positions: { user_id: string | null }[] })
    .department_positions;
  const ownerId = Array.isArray(positions) ? positions[0]?.user_id : undefined;
  if (ownerId !== data.user.id) {
    return { ok: false, status: 403, message: 'Você só pode conectar a sua própria linha.' };
  }
  return { ok: true, userId: data.user.id };
}
