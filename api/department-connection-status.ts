import { createClient } from '@supabase/supabase-js';
import { decrypt, getCredential } from '../src/lib/credentials.js';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { isEvolutionConnected, readEvolutionConnectionState } from '../src/lib/evolutionState.js';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
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

async function inspect(
  row: ConnectionRow,
  globalServerUrl: string,
  globalApiKey: string,
) {
  const serverUrl = (row.server_url ?? globalServerUrl).replace(/\/$/, '');
  let apiKey = globalApiKey;
  if (row.api_key_encrypted) {
    try {
      apiKey = decrypt(row.api_key_encrypted);
    } catch {
      return { id: row.id, configured: false, connected: false, state: null, error: 'Chave da linha inválida.' };
    }
  }
  if (!serverUrl || !apiKey) {
    return { id: row.id, configured: false, connected: false, state: null };
  }

  try {
    const response = await fetch(
      `${serverUrl}/instance/connectionState/${encodeURIComponent(row.instance)}`,
      { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) {
      return {
        id: row.id,
        configured: true,
        connected: false,
        state: null,
        error: `Evolution respondeu ${response.status}.`,
      };
    }
    const body = await response.json() as Record<string, unknown>;
    const state = readEvolutionConnectionState(body);
    return {
      id: row.id,
      configured: true,
      connected: isEvolutionConnected(state),
      state,
      error: state ? undefined : 'Resposta sem estado reconhecido.',
    };
  } catch (error) {
    return {
      id: row.id,
      configured: true,
      connected: false,
      state: null,
      error: error instanceof Error ? error.message : 'Falha ao consultar a Evolution.',
    };
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    const auth = await requireAdmin(req.headers?.authorization ?? req.headers?.Authorization);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

    const { data, error } = await getAdmin()
      .schema('whatsapp_hub')
      .from('department_connections')
      .select('id, instance, server_url, api_key_encrypted')
      .order('created_at');
    if (error) throw error;

    const globalServerUrl = (await getCredential('evolution_server_url')) ?? '';
    const globalApiKey = (await getCredential('evolution_api_key')) ?? '';
    const statuses = await Promise.all(
      ((data ?? []) as ConnectionRow[]).map((row) => inspect(row, globalServerUrl, globalApiKey)),
    );
    return res.status(200).json({ success: true, statuses });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Erro interno',
    });
  }
}
