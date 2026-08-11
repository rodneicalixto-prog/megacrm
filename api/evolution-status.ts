import { getCredential } from '../src/lib/credentials.js';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { isEvolutionConnected, readEvolutionConnectionState } from '../src/lib/evolutionState.js';

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
      const raw = await r.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (!r.ok) {
        return res.status(200).json({
          success: true,
          configured: true,
          connected: false,
          error: `Evolution respondeu ${r.status}`,
          webhook_url: hook,
        });
      }
      // A forma da resposta varia entre versoes da Evolution v2: umas devolvem
      // { instance: { instanceName, state } }, outras { state } na raiz, e as
      // que reaproveitam o shape do fetchInstances usam `connectionStatus` no
      // lugar de `state`. Ler so uma delas fazia uma instancia conectada
      // aparecer como offline, sem erro nenhum para explicar o porque.
      const nestedInstance = (body.instance ?? {}) as Record<string, unknown>;
      const pick = (k: string): string | null => {
        const v = nestedInstance[k] ?? body[k];
        return typeof v === 'string' ? v : null;
      };
      const state = readEvolutionConnectionState(body);
      return res.status(200).json({
        success: true,
        configured: true,
        // 'open' e o valor da v2; 'connected'/'online' aparecem em forks.
        connected: isEvolutionConnected(state),
        state,
        instance_name: pick('instanceName') ?? instance,
        // Sem isto, um shape novo volta a virar um 'nao conectado' mudo.
        error: state ? undefined : `Evolution respondeu 200 sem estado reconhecido: ${raw.slice(0, 200)}`,
        webhook_url: hook,
      });
    }

    // POST → registra o webhook na instância.
    if (!hook) {
      return res.status(500).json({ success: false, message: 'SUPABASE_URL ausente no runtime.' });
    }

    // A Evolution v2 mudou o corpo do /webhook/set no meio da serie: da 2.2 em
    // diante ele vem ANINHADO em `webhook`, com as chaves `byEvents`/`base64`;
    // antes disso era achatado, com `webhookByEvents`/`webhookBase64`. A doc
    // publica ainda mostra a forma antiga. Como o servidor e do usuario e a
    // versao varia, tentamos a forma nova e caimos na antiga se ela for
    // recusada — mais barato que obrigar o usuario a descobrir a versao.
    //
    // byEvents fica FALSE de proposito: ligado, a Evolution anexa o nome do
    // evento ao path da URL e a rota unica da Edge Function nunca e chamada.
    // Só MESSAGES_UPSERT interessa; o resto o parser descarta de qualquer jeito.
    const nested = {
      webhook: {
        enabled: true,
        url: hook,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT'],
      },
    };
    const flat = {
      enabled: true,
      url: hook,
      webhookByEvents: false,
      webhookBase64: false,
      events: ['MESSAGES_UPSERT'],
    };

    const endpoint = `${serverUrl}/webhook/set/${encodeURIComponent(instance)}`;
    async function postWebhook(payload: unknown) {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      return { ok: r.ok, status: r.status, body: await r.text() };
    }

    let attempt = await postWebhook(nested);
    let shape = 'nested';
    if (!attempt.ok) {
      const fallback = await postWebhook(flat);
      if (fallback.ok) {
        attempt = fallback;
        shape = 'flat';
      } else {
        return res.status(200).json({
          success: false,
          message:
            `Evolution rejeitou o webhook. ` +
            `Aninhado (${attempt.status}): ${attempt.body.slice(0, 150)} | ` +
            `Achatado (${fallback.status}): ${fallback.body.slice(0, 150)}`,
          webhook_url: hook,
        });
      }
    }

    return res.status(200).json({ success: true, webhook_url: hook, shape, echo: attempt.body.slice(0, 400) });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Erro interno',
    });
  }
}
