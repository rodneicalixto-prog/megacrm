import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { encrypt } from '../src/lib/credentials.js';

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

interface CreateConnectionBody {
  id?: unknown;
  departmentId?: unknown;
  positionId?: unknown;
  instance?: unknown;
  label?: unknown;
  phone?: unknown;
  serverUrl?: unknown;
  apiKey?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalUuid(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('Identificador de cargo inválido.');
  }
  return normalized;
}

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase core não configurado.');
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).end();
    const auth = await requireAdmin(req.headers?.authorization ?? req.headers?.Authorization);
    if (auth.ok === false) return res.status(auth.status).json({ success: false, message: auth.message });

    const body = (req.body ?? {}) as CreateConnectionBody;
    const departmentId = optionalUuid(body.departmentId);
    const positionId = optionalUuid(body.positionId);
    const instance = text(body.instance);
    const serverUrl = text(body.serverUrl).replace(/\/$/, '');
    const apiKey = text(body.apiKey);
    if (req.method === 'PATCH') {
      const id = optionalUuid(body.id);
      if (!id) return res.status(400).json({ success: false, message: 'Linha inválida.' });
      if (Boolean(serverUrl) !== Boolean(apiKey)) {
        return res.status(400).json({
          success: false,
          message: 'Informe URL e chave juntas, ou esvazie ambas para voltar à credencial global.',
        });
      }
      if (serverUrl) {
        const parsed = new URL(serverUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL da Evolution inválida.');
      }
      const { error } = await getAdmin().schema('whatsapp_hub')
        .from('department_connections')
        .update({
          server_url: serverUrl || null,
          api_key_encrypted: apiKey ? encrypt(apiKey) : null,
        })
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (!departmentId || !instance) {
      return res.status(400).json({ success: false, message: 'Setor e instância são obrigatórios.' });
    }
    if (Boolean(serverUrl) !== Boolean(apiKey)) {
      return res.status(400).json({
        success: false,
        message: 'Informe URL e chave da linha juntas, ou deixe ambas vazias para usar a credencial global.',
      });
    }
    if (serverUrl) {
      const parsed = new URL(serverUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL da Evolution inválida.');
    }

    const admin = getAdmin().schema('whatsapp_hub');
    if (positionId) {
      const { data: position, error: positionError } = await admin
        .from('department_positions')
        .select('id')
        .eq('id', positionId)
        .eq('department_id', departmentId)
        .maybeSingle();
      if (positionError) throw positionError;
      if (!position) {
        return res.status(400).json({ success: false, message: 'O cargo não pertence ao setor selecionado.' });
      }
    }

    const { data, error } = await admin
      .from('department_connections')
      .insert({
        department_id: departmentId,
        position_id: positionId,
        instance,
        label: text(body.label) || null,
        phone_number: text(body.phone) || null,
        server_url: serverUrl || null,
        api_key_encrypted: apiKey ? encrypt(apiKey) : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return res.status(201).json({ success: true, id: data.id });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Não foi possível cadastrar a linha.',
    });
  }
}
