import { getCredential } from '../src/lib/credentials.js';
import { requireAdmin } from '../src/lib/admin-auth.js';

// Status e webhook da instância Evolution (server-side; a API key nunca vai ao
// browser). Doc oficial (doc.evolution-api.com, v2):
//   GET  /instance/connectionState/{instance}  — header `apikey`
//                                                → { instance: { instanceName, state } }
//   POST /webhook/set/{instance}               — header `apikey`
//                                                → { enabled, url, webhookByEvents, events[] }
// GET  aqui → estado da conexão + URL do webhook a cadastrar.
// POST aqui → registra o webhook na Evolution automaticamente.

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  end: () => void;
};

function webhookUrl(): string | null {
  const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/functions/v1/whatsapp-inbound?provider=evolution` : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    const auth = await requireAdmin(req.headers?.authorization ?? req.headers?.Authorization);
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, message: auth.message });
    }

    const serverUrl = ((await getCredential('evolution_server_url')) ?? '').replace(/\/$/, '');
    const apiKey = (await getCredential('evolution_api_key')) ?? '';
    const instance = (await getCredential('evolution_instance')) ?? '';
    const hook = webhookUrl();

    if (!serverUrl || !apiKey || !instance) {
      return res.status(200).json({ success: true, configured: false, webhook_url: hook });
    }

    if (req.method === 'GET') {
      const r = await fetch(`${serverUrl}/instance/connectionState/${encodeURIComponent(instance)}`, {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(10000),
      });
      const body = (await r.json().catch(() => ({}))) as {
        instance?: { instanceName?: string; state?: string };
      };
      if (!r.ok) {
        return res.status(200).json({
          success: true,
          configured: true,
          connected: false,
          error: `Evolution respondeu ${r.status}`,
          webhook_url: hook,
        });
      }
      // state: 'open' (conectado) | 'connecting' | 'close'.
      const state = body.instance?.state ?? null;
      return res.status(200).json({
        success: true,
        configured: true,
        connected: state === 'open',
        state,
        instance_name: body.instance?.instanceName ?? instance,
        webhook_url: hook,
      });
    }

    // POST → registra o webhook na instância.
    if (!hook) {
      return res.status(500).json({ success: false, message: 'SUPABASE_URL ausente no runtime.' });
    }
    const r = await fetch(`${serverUrl}/webhook/set/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        url: hook,
        // webhookByEvents anexaria o nome do evento ao path e quebraria a rota
        // única da Edge Function — tem que ficar false.
        webhookByEvents: false,
        webhookBase64: false,
        // Só o evento de mensagem recebida interessa; o resto viraria ruído que
        // o parser descarta de qualquer jeito.
        events: ['MESSAGES_UPSERT'],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await r.text();
    if (!r.ok) {
      return res.status(200).json({
        success: false,
        message: `Evolution rejeitou o webhook (${r.status}): ${body.slice(0, 200)}`,
        webhook_url: hook,
      });
    }
    return res.status(200).json({ success: true, webhook_url: hook });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Erro interno',
    });
  }
}
