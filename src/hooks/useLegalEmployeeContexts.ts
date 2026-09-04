import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { LegalCaseEmployeeContext } from '@/types/legal';

// Lista enxuta de todo contexto de RH já preenchido, usada só pra filtrar a
// lista de processos pelos eixos de RH (turno/gestor/setor/sindicato/etc) —
// não é uma tela própria, é suporte pra LegalCasesPage.
export function useLegalEmployeeContexts() {
  const [contexts, setContexts] = useState<LegalCaseEmployeeContext[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await getSupabase().schema('whatsapp_hub').from('legal_case_employee_context').select('*');
      if (cancelled) return;
      if (error) {
        console.error('[useLegalEmployeeContexts] falha ao carregar contextos', error);
      } else {
        setContexts((data ?? []) as LegalCaseEmployeeContext[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { contexts, loading };
}
