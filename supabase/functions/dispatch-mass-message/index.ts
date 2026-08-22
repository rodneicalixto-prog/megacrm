// ============================================================================
// dispatch-mass-message  (cron target, 30s)
// ----------------------------------------------------------------------------
// Disparo em massa via Evolution (WhatsApp Web) — módulo paralelo a
// dispatch-campaign (que usa Zernio/Broadcasts com template aprovado). Por
// tick, por disparo em `sending` cujo next_send_at já chegou:
//
//   1. Reserva UM contato pendente (claim_mass_dispatch_contact — SKIP LOCKED).
//   2. Sorteia um dos até 5 modelos de mensagem do disparo.
//   3. Envia via Evolution (mesma lógica de _shared/whatsapp/outbound.ts,
//      inlinizada aqui — ver nota de bundling abaixo), espelha na inbox
//      (conversa + mensagem outbound) e marca o contato.
//   4. Agenda o próximo envio DESTE disparo para now() + random(min,max)s —
//      nunca manda mais de uma mensagem por disparo por tick. A cadência
//      mínima real é o tick do cron (30s); min_delay abaixo disso não
//      acelera, só reduz o jitter adicional.
//
// Sem confirmação de entrega/leitura (Evolution não manda esse webhook aqui
// hoje) — "respondeu" é inferido por trigger no INSERT de mensagem inbound
// (ver migration 20260821250000_mass_dispatch.sql).
//
// NOTA DE BUNDLING: o mecanismo de deploy via MCP do Supabase usado nesta
// sessão achata todo arquivo enviado sob um único diretório `source/`,
// quebrando imports relativos de `_shared/*` (mesmo problema documentado em
// PLANEJAMENTO.md ao deployar get-instance-plan). Os deploys anteriores desta
// mesma base (ex.: dispatch-campaign) contornam isso publicando um único
// arquivo com as dependências de `_shared/` inlinizadas — mesmo padrão
// seguido aqui. O código-fonte "de verdade" (para `supabase functions
// deploy` via CLI) fica nos arquivos reais em supabase/functions/_shared/;
// este arquivo é a versão achatada para este mecanismo de deploy específico.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ---- supabase-admin.ts -----------------------------------------------------
function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'whatsapp_hub' },
  });
}

// ---- cors.ts ----------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...(init.headers ?? {}) },
  });
}

function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  return null;
}

// ---- auth.ts (só o gate de service role) ------------------------------------
class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
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

async function requireServiceRole(req: Request): Promise<void> {
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

// ---- credentials.ts (decrypt-only, com cache de 60s) -------------------------
const decoder = new TextDecoder();
const credCache = new Map<string, { value: string | null; expiresAt: number }>();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function getCryptoKey(): Promise<CryptoKey> {
  const hex = Deno.env.get('CRYPTO_KEY');
  if (!hex || !/^[a-f0-9]{64}$/i.test(hex)) throw new Error('CRYPTO_KEY ausente ou invalida');
  return crypto.subtle.importKey('raw', hexToBytes(hex), { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decrypt(payload: string): Promise<string> {
  const [ivHex, tagHex, cipherHex] = payload.split(':');
  if (!ivHex || !tagHex || !cipherHex) throw new Error('Payload de criptografia malformado');
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const cipher = hexToBytes(cipherHex);
  const combined = new Uint8Array(cipher.length + tag.length);
  combined.set(cipher);
  combined.set(tag, cipher.length);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await getCryptoKey(), combined);
  return decoder.decode(plain);
}

function getSupabaseAdminPublic() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getCredential(key: string): Promise<string | null> {
  const cached = credCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const supabase = getSupabaseAdminPublic();
  const { data, error } = await supabase.from('app_settings').select('value_encrypted').eq('key', key).maybeSingle();
  if (error) throw error;
  const value = data?.value_encrypted ? await decrypt(data.value_encrypted) : null;
  credCache.set(key, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

// ---- whatsapp/types.ts (helpers de leitura tolerante) ------------------------
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

interface SendResult {
  ok: boolean;
  messageId: string | null;
  raw: unknown;
  error?: string;
}

// ---- whatsapp/evolution-provider.ts (trimmed: só o que sendMessage precisa) --
function toMediaType(raw: string | undefined): 'image' | 'video' | 'document' {
  if (raw === 'image' || raw === 'video') return raw;
  return 'document';
}

class EvolutionProvider {
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(serverUrl: string, apiKey: string, instance: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.instance = instance;
  }

  async sendMessage(
    to: string,
    text: string,
    opts: { mediaUrl?: string | null; mediaType?: string } = {},
  ): Promise<SendResult> {
    const number = to.replace(/\D/g, '');
    try {
      const isAudio = opts.mediaUrl != null && opts.mediaType === 'audio';
      const path = opts.mediaUrl
        ? isAudio
          ? `/message/sendWhatsAppAudio/${this.instance}`
          : `/message/sendMedia/${this.instance}`
        : `/message/sendText/${this.instance}`;

      const body = !opts.mediaUrl
        ? { number, text }
        : isAudio
          ? { number, audio: opts.mediaUrl }
          : { number, mediatype: toMediaType(opts.mediaType), media: opts.mediaUrl, caption: text || undefined };

      const res = await fetch(`${this.serverUrl}${path}`, {
        method: 'POST',
        headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      const messageId = str(asObject(asObject(raw).key), ['id']) ?? str(asObject(raw), ['id']);
      return { ok: res.ok, messageId, raw, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, messageId: null, raw: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---- whatsapp/department-routing.ts (trimmed: só connectionForConversation) --
interface DepartmentConnection {
  connectionId: string | null;
  departmentId: string;
  instance: string;
  serverUrl: string;
  apiKey: string;
}

async function globalConnection(): Promise<{ serverUrl: string; apiKey: string; instance: string } | null> {
  const serverUrl = (await getCredential('evolution_server_url')) ?? '';
  const apiKey = (await getCredential('evolution_api_key')) ?? '';
  const instance = (await getCredential('evolution_instance')) ?? '';
  if (!serverUrl || !apiKey || !instance) return null;
  return { serverUrl, apiKey, instance };
}

async function hydrate(row: {
  id?: string;
  department_id: string;
  instance: string;
  server_url: string | null;
  api_key_encrypted: string | null;
}): Promise<DepartmentConnection | null> {
  let serverUrl = row.server_url ?? '';
  let apiKey = '';
  if (row.api_key_encrypted) {
    try {
      apiKey = await decrypt(row.api_key_encrypted);
    } catch {
      return null;
    }
  }
  if (!serverUrl || !apiKey) {
    const global = await globalConnection();
    if (!global) return null;
    serverUrl = serverUrl || global.serverUrl;
    apiKey = apiKey || global.apiKey;
  }
  return { connectionId: row.id ?? null, departmentId: row.department_id, instance: row.instance, serverUrl, apiKey };
}

async function connectionForConversation(connectionId: string | null | undefined): Promise<DepartmentConnection | null> {
  if (connectionId) {
    const { data } = await getAdminClient()
      .from('department_connections')
      .select('id, department_id, instance, server_url, api_key_encrypted')
      .eq('id', connectionId)
      .maybeSingle();
    if (data) return hydrate(data as never);
  }
  const global = await globalConnection();
  if (!global) return null;
  return { connectionId: null, departmentId: '', instance: global.instance, serverUrl: global.serverUrl, apiKey: global.apiKey };
}

function providerFor(conn: DepartmentConnection): EvolutionProvider {
  return new EvolutionProvider(conn.serverUrl, conn.apiKey, conn.instance);
}

// ---- dispatcher --------------------------------------------------------------
const PER_TICK_DISPATCHES = 50;

interface DispatchRow {
  id: string;
  connection_id: string;
  min_delay_seconds: number;
  max_delay_seconds: number;
}

interface MessageRow {
  id: string;
  content: string;
  media_url: string | null;
  media_type: string | null;
}

interface ContactRow {
  id: string;
  dispatch_id: string;
  contact_id: string;
}

function randomDelaySeconds(min: number, max: number): number {
  const lo = Math.max(5, min);
  const hi = Math.max(lo, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

async function findOrCreateConversation(
  admin: ReturnType<typeof getAdminClient>,
  contactId: string,
  connectionId: string,
  departmentId: string | null,
): Promise<string | null> {
  const { data: existing } = await admin.from('conversations').select('id').eq('contact_id', contactId).maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: created, error } = await admin
    .from('conversations')
    .insert({
      contact_id: contactId,
      status: 'ai_active',
      channel: 'evolution',
      connection_id: connectionId,
      department_id: departmentId,
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) return null;
  return (created as { id: string }).id;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireServiceRole(req);
  } catch {
    return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();

  // 1. Promove scheduled → sending para disparos cujo horário chegou.
  const nowIso = new Date().toISOString();
  await admin
    .from('mass_dispatches')
    .update({ status: 'sending', started_at: nowIso })
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso);

  // 2. Disparos elegíveis neste tick.
  const { data: dispatches, error: dErr } = await admin
    .from('mass_dispatches')
    .select('id, connection_id, min_delay_seconds, max_delay_seconds')
    .eq('status', 'sending')
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .limit(PER_TICK_DISPATCHES);
  if (dErr) return jsonResponse({ ok: false, error: dErr.message }, { status: 500 });

  const rows = (dispatches ?? []) as DispatchRow[];
  if (rows.length === 0) return jsonResponse({ ok: true, processed: 0 });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const d of rows) {
    const { data: claimed, error: cErr } = await admin.rpc('claim_mass_dispatch_contact', { p_dispatch_id: d.id });
    if (cErr) {
      errors.push(`dispatch ${d.id}: ${cErr.message}`);
      continue;
    }
    const queue = (claimed ?? []) as ContactRow[];
    if (queue.length === 0) {
      const { count: pendingLeft } = await admin
        .from('mass_dispatch_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('dispatch_id', d.id)
        .eq('status', 'pending');
      if ((pendingLeft ?? 0) === 0) {
        await admin
          .from('mass_dispatches')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', d.id);
      }
      continue;
    }
    const row = queue[0];

    const { data: messages } = await admin
      .from('mass_dispatch_messages')
      .select('id, content, media_url, media_type')
      .eq('dispatch_id', d.id);
    const variants = (messages ?? []) as MessageRow[];
    if (variants.length === 0) {
      await admin
        .from('mass_dispatch_contacts')
        .update({ status: 'failed', claimed_at: null, error_message: 'Disparo sem modelo de mensagem' })
        .eq('id', row.id);
      await admin.rpc('bump_mass_dispatch_counter', { p_dispatch_id: d.id, p_column: 'failed', p_delta: 1 });
      failed++;
      continue;
    }
    const message = variants[Math.floor(Math.random() * variants.length)];

    const { data: contact } = await admin.from('contacts').select('phone').eq('id', row.contact_id).maybeSingle();
    const phone = (contact as { phone?: string } | null)?.phone ?? null;

    const releaseFailed = async (msg: string) => {
      await admin
        .from('mass_dispatch_contacts')
        .update({ status: 'failed', claimed_at: null, error_message: msg })
        .eq('id', row.id);
      await admin.rpc('bump_mass_dispatch_counter', { p_dispatch_id: d.id, p_column: 'failed', p_delta: 1 });
      failed++;
    };

    if (!phone) {
      await releaseFailed('Contato sem telefone');
    } else {
      try {
        const conn = await connectionForConversation(d.connection_id);
        if (!conn) throw new Error('Conexão Evolution não encontrada ou sem credenciais.');
        const provider = providerFor(conn);
        const result = await provider.sendMessage(phone, message.content, {
          mediaUrl: message.media_url ?? undefined,
          mediaType: message.media_type ?? undefined,
        });
        if (!result.ok) throw new Error(result.error ?? 'Erro ao enviar via Evolution.');

        const sentAt = new Date().toISOString();
        await admin
          .from('mass_dispatch_contacts')
          .update({
            status: 'sent',
            claimed_at: null,
            sent_at: sentAt,
            message_id_used: message.id,
            evolution_message_id: result.messageId ?? null,
            error_message: null,
          })
          .eq('id', row.id);
        await admin.rpc('bump_mass_dispatch_counter', { p_dispatch_id: d.id, p_column: 'sent', p_delta: 1 });
        sent++;

        try {
          const conversationId = await findOrCreateConversation(admin, row.contact_id, d.connection_id, conn.departmentId || null);
          if (conversationId) {
            const contentType = !message.media_url
              ? 'text'
              : (['image', 'video', 'audio'].includes(message.media_type ?? '') ? message.media_type! : 'document');
            await admin.from('messages').insert({
              conversation_id: conversationId,
              direction: 'outbound',
              sender_type: 'system',
              content_type: contentType,
              content: message.content,
              media_url: message.media_url,
              zernio_message_id: result.messageId ? `evolution:${result.messageId}` : null,
              meta_status: 'sent',
              is_private_note: false,
            });
            await admin.from('conversations').update({ last_message_at: sentAt }).eq('id', conversationId);
          }
        } catch (inboxErr) {
          errors.push(`dispatch ${d.id}: inbox mirror: ${inboxErr instanceof Error ? inboxErr.message : 'erro'}`);
        }
      } catch (err) {
        await releaseFailed(err instanceof Error ? err.message : 'Erro ao enviar via Evolution.');
      }
    }

    await admin
      .from('mass_dispatches')
      .update({
        next_send_at: new Date(Date.now() + randomDelaySeconds(d.min_delay_seconds, d.max_delay_seconds) * 1000).toISOString(),
      })
      .eq('id', d.id);
  }

  return jsonResponse({ ok: true, dispatches: rows.length, sent, failed, errors });
});
