import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { LegalCase, LegalCaseStatus } from '@/types/legal';

export interface CreateLegalCaseInput {
  title: string;
  department_id: string;
  case_number?: string | null;
  status?: LegalCaseStatus;
  next_deadline_at?: string | null;
  next_deadline_label?: string | null;
  owner_id?: string | null;
  external_counsel?: string | null;
  opposing_party?: string | null;
  court_reference?: string | null;
  classification?: string | null;
  summary?: string | null;
}

// Lista de processos — sem recorte por departamento no client (a RLS já
// resolve isso via can_access_legal(): quem chega aqui já pode ver RH e DP
// juntos, mesmo padrão do modelo visual aprovado).
export function useLegalCases() {
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .schema('whatsapp_hub')
      .from('legal_cases')
      .select('*')
      .order('next_deadline_at', { ascending: true, nullsFirst: false });
    if (err) {
      console.error('[useLegalCases] falha ao carregar processos', err);
      setError(err.message);
      setLoading(false);
      return;
    }
    setError(null);
    setCases((data ?? []) as LegalCase[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const suffix = Math.random().toString(36).slice(2, 10);
    const channel = getSupabase()
      .channel(`legal-cases:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'whatsapp_hub', table: 'legal_cases' }, () => void reload())
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [reload]);

  const createCase = useCallback(async (input: CreateLegalCaseInput) => {
    const { data, error: err } = await getSupabase()
      .schema('whatsapp_hub')
      .from('legal_cases')
      .insert(input)
      .select('id')
      .single();
    if (err) return { ok: false as const, error: err.message };
    return { ok: true as const, id: (data as { id: string }).id };
  }, []);

  return { cases, loading, error, reload, createCase };
}
