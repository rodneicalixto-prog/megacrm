import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { decrypt, getCredential, setCredential } from '../src/lib/credentials.js';
import { readEvolutionQr } from '../src/lib/evolutionQr.js';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  end: () => void;
};

interface ConnectionRow {
  id: string;
  instance: string;
  server_url: string | null;
  api_key_encrypted: string | null;
}

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase core não configurado.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uuid(value: unknown): string {
  const normalized = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('Linha inválida.');
  }
  return normalized;
}

function json(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function request(
  url: string,
  apiKey: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; raw: string; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  return { ok: response.ok, status: response.status, raw, body: json(raw) };
}

async function registerWebhook(
  serverUrl: string,
  apiKey: string,
  instance: string,
): Promise<{ registered: boolean; warning?: string }> {
  let secret = await getCredential('evolution_webhook_secret');
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    await setCredential('evolution_webhook_secret', secret);
  }
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  if (!supabaseUrl) return { registered: false, warning: 'SUPABASE_URL ausente no runtime.' };
  const hook = `${supabaseUrl}/functions/v1/whatsapp-inbound?provider=evolution&token=${encodeURIComponent(secret)}`;
  const endpoint = `${serverUrl}/webhook/set/${encodeURIComponent(instance)}`;
  const payloads = [
    { webhook: { enabled: true, url: hook, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] } },
    { enabled: true, url: hook, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT'] },
  ];
  const errors: string[] = [];
  for (const payload of payloads) {
    const result = await request(endpoint, apiKey, { method: 'POST', body: JSON.stringify(payload) });
    if (result.ok) return { registered: true };
    errors.push(`${result.status}: ${result.raw.slice(0, 120)}`);
  }
  return { registered: false, warning: `Webhook não registrado (${errors.join(' | ')}).` };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const auth = await requireAdmin(req.headers?.authorization ?? req.headers?.Authorization);
    if (auth.ok === false) return res.status(auth.status).json({ success: false, message: auth.message });

    const connectionId = uuid((req.body as { connectionId?: unknown } | null)?.connectionId);
    const { data, error } = await getAdmin().schema('whatsapp_hub')
      .from('department_connections')
      .select('id, instance, server_url, api_key_encrypted')
      .eq('id', connectionId)
      .single();
    if (error || !data) throw new Error('Linha não encontrada.');
    const row = data as ConnectionRow;

    const serverUrl = (row.server_url ?? await getCredential('evolution_server_url') ?? '').replace(/\/$/, '');
    const apiKey = row.api_key_encrypted
      ? decrypt(row.api_key_encrypted)
      : (await getCredential('evolution_api_key') ?? '');
    if (!serverUrl || !apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Configure a URL e a API key da Evolution em Credenciais ou nesta linha.',
      });
    }

    const instance = row.instance;
    const connectUrl = `${serverUrl}/instance/connect/${encodeURIComponent(instance)}`;
    let source = await request(`${serverUrl}/instance/create`, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        instanceName: instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      }),
    });

    // Uma linha pode já existir na Evolution. Nesse caso, criar retorna erro,
    // mas /connect continua sendo a operação correta para emitir um QR novo.
    let qr = readEvolutionQr(source.body);
    const createError = source.ok ? null : `${source.status}: ${source.raw.slice(0, 180)}`;
    if (!qr.image && !qr.pairingCode) {
      const connect = await request(connectUrl, apiKey);
      if (connect.ok) {
        source = connect;
        qr = readEvolutionQr(connect.body);
      } else if (!source.ok) {
        return res.status(502).json({
          success: false,
          message: `A Evolution recusou criar e conectar a instância. Criar (${createError}); conectar (${connect.status}: ${connect.raw.slice(0, 180)}).`,
        });
      }
    }

    const webhook = await registerWebhook(serverUrl, apiKey, instance);
    return res.status(200).json({
      success: true,
      instance,
      qr_image: qr.image,
      pairing_code: qr.pairingCode,
      webhook_registered: webhook.registered,
      warning: webhook.warning ?? (createError ? `A instância já existia ou não precisou ser recriada (${createError}).` : undefined),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Não foi possível conectar a linha.',
    });
  }
}
