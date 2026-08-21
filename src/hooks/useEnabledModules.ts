import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { CommercialModule } from '@/lib/plan';

// Lê os módulos do pacote comercial habilitados nesta instalação (Campanhas /
// Vendas & Recompra / Agente de IA) via a Edge Function get-instance-plan.
// Qualquer usuário autenticado pode chamar — o gate é por instalação, não por
// papel. Enquanto carrega (ou se a chamada falhar), assume tudo habilitado
// (fail-open): a maioria das instalações tem o pacote completo, e não faz
// sentido esconder/redirecionar por causa de uma race de rede — só esconde de
// verdade depois que a resposta confirma que o módulo falta.
export function useEnabledModules() {
  const [enabled, setEnabled] = useState<Set<CommercialModule> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.functions.invoke('get-instance-plan', { body: {} });
        const modules = data?.data?.enabledModules as CommercialModule[] | undefined;
        if (!cancelled && Array.isArray(modules)) {
          setEnabled(new Set(modules));
        }
      } catch {
        // Falha de rede: mantém fail-open (não esconde nada).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasModule = (module: CommercialModule): boolean => !enabled || enabled.has(module);

  return { loading, hasModule };
}
