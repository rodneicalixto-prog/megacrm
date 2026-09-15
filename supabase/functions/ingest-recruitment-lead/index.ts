// ============================================================================
// ingest-recruitment-lead  (público, CORS aberto)
// ----------------------------------------------------------------------------
// Versão de ingest-lead dedicada a candidatos de vaga (fluxo n8n
// "RH — Triagem de Candidatos"). Cria/atualiza o contato e registra o card
// no pipeline "Recrutamento" via RPC ingest_recruitment_lead — nunca no
// funil Comercial.
//
// Autossuficiente (sem imports de ../_shared/*): o deploy via Composio envia
// um único arquivo, então CORS, admin client, rate limit e log ficam inline
// em vez de importados dos módulos compartilhados do repo.
//
// Deploy com verify_jwt=false (chamado direto do n8n, sem token de usuário).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const appOrigin = Deno.env.get('APP_ORIGIN')?.trim() || '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...(init.headers ?? {}) },
  });
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'whatsapp_hub' },
  });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

async function isRateLimited(req: Request, scope: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_scope: scope,
      p_identifier: clientIp(req),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error(JSON.stringify({ event: 'rate_limit_check_failed', scope, message: error.message }));
      return false;
    }
    return data !== true;
  } catch (err) {
    console.error(JSON.stringify({ event: 'rate_limit_check_error', scope, message: String(err) }));
    return false;
  }
}

interface RecruitmentLeadBody {
  name?: string;
  phone?: string;
  vaga?: string;
  raw?: Record<string, unknown>;
}

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function normalizePhone(raw: string): string {
  const t = raw.trim();
  return t.startsWith('+') ? t : `+${t.replace(/[^\d]/g, '')}`;
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
    }
    if (await isRateLimited(req, 'ingest-recruitment-lead', 20, 60)) {
      return jsonResponse({ ok: false, error: 'Rate limit excedido' }, { status: 429 });
    }

    let body: RecruitmentLeadBody;
    try { body = (await req.json()) as RecruitmentLeadBody; }
    catch { return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

    const phone = clean(body.phone) ? normalizePhone(body.phone!) : null;
    const name = clean(body.name);
    if (!phone) {
      return jsonResponse({ ok: false, error: 'Informe telefone.' }, { status: 400 });
    }

    const admin = getAdminClient();

    let contactId: string | null = null;
    const { data: existing } = await admin.from('contacts').select('id').eq('phone', phone).maybeSingle();
    if (existing) contactId = (existing as { id: string }).id;
    else {
      const insert: Record<string, unknown> = { name, phone, source: 'whatsapp_recrutamento' };
      const { data: created, error } = await admin.from('contacts').insert(insert).select('id').single();
      if (error) return jsonResponse({ ok: false, error: `contato: ${error.message}` }, { status: 500 });
      contactId = (created as { id: string }).id;
    }

    const { data: result, error: rpcErr } = await admin.rpc('ingest_recruitment_lead', {
      p_contact_id: contactId,
      p_vaga: clean(body.vaga),
      p_raw: body.raw && typeof body.raw === 'object' ? body.raw : null,
    });
    if (rpcErr) return jsonResponse({ ok: false, error: `ingestão: ${rpcErr.message}` }, { status: 500 });

    console.log(JSON.stringify({ event: 'recruitment_lead_ingested', result }));
    return jsonResponse({ ok: true, deal: result });
  } catch (err) {
    console.error(JSON.stringify({ event: 'ingest_recruitment_lead_unhandled_error', message: String(err) }));
    return jsonResponse({ ok: false, error: 'Erro interno.' }, { status: 500 });
  }
});
