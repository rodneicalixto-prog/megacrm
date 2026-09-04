import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { LegalActionPlan, LegalActionPlanStatus } from '@/types/legal';

export interface ActionPlanInput {
  classification: string;
  title: string;
  owner_id?: string | null;
  status?: LegalActionPlanStatus;
  swot_strengths?: string[];
  swot_weaknesses?: string[];
  swot_opportunities?: string[];
  swot_threats?: string[];
  w5h2_what?: string | null;
  w5h2_why?: string | null;
  w5h2_where?: string | null;
  w5h2_when?: string | null;
  w5h2_who?: string | null;
  w5h2_how?: string | null;
  w5h2_how_much?: string | null;
}

// Plano de ação de prevenção por causa/classificação — mesmo shape de hook de
// useLegalCases.ts (list + create), com update pra edição.
export function useLegalActionPlans() {
  const [plans, setPlans] = useState<LegalActionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .schema('whatsapp_hub')
      .from('legal_action_plans')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) {
      console.error('[useLegalActionPlans] falha ao carregar planos', err);
      setError(err.message);
      setLoading(false);
      return;
    }
    setError(null);
    setPlans((data ?? []) as LegalActionPlan[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createPlan = useCallback(async (input: ActionPlanInput) => {
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_action_plans').insert(input);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  const updatePlan = useCallback(async (id: string, input: ActionPlanInput) => {
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_action_plans').update(input).eq('id', id);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  return { plans, loading, error, reload, createPlan, updatePlan };
}
