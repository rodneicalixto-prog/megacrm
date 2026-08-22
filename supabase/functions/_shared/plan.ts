// Confere se um módulo do pacote comercial contratado está habilitado nesta
// instalação (Campanhas / Vendas & Recompra / Agente de IA). Fonte de
// verdade: public.instance_plan — RLS sem policies, só service role lê/
// escreve; setado manualmente via SQL/MCP no provisionamento do cliente, não
// existe UI de edição (ver 20260821210000_commercial_plan_modules.sql).
// Sem linha configurada, cai em fail-open (todos os módulos habilitados) —
// não vamos travar instalações existentes que nunca tiveram o pacote setado.
import { getAdminClient } from './supabase-admin.ts';

export type CommercialModule = 'campaigns' | 'vendas' | 'ai_agent' | 'disparo_massa';

const ALL_MODULES: CommercialModule[] = ['campaigns', 'vendas', 'ai_agent', 'disparo_massa'];

export async function getEnabledModules(): Promise<CommercialModule[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .schema('public')
    .from('instance_plan')
    .select('enabled_modules')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return ALL_MODULES;
  return (data.enabled_modules as CommercialModule[] | null) ?? ALL_MODULES;
}

export async function isModuleEnabled(module: CommercialModule): Promise<boolean> {
  const enabled = await getEnabledModules();
  return enabled.includes(module);
}
