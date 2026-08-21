// ============================================================================
// get-instance-plan
// ----------------------------------------------------------------------------
// Devolve os módulos do pacote comercial habilitados nesta instalação
// (Campanhas / Vendas & Recompra / Agente de IA), pra sidebar e as páginas
// esconderem o que o cliente não contratou. Qualquer usuário autenticado pode
// chamar — o gate é por instalação, não por papel. A fonte
// (public.instance_plan) é setada manualmente via SQL/MCP no provisionamento
// do cliente; não existe UI de edição (ver _shared/plan.ts).
// ============================================================================

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { getEnabledModules } from '../_shared/plan.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireCaller(req);
    const enabledModules = await getEnabledModules();
    return jsonResponse({ data: { enabledModules }, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ data: null, error: err.message }, { status: err.status });
    }
    console.error('get-instance-plan error', err);
    return jsonResponse(
      { data: null, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
