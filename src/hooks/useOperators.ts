import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface Operator {
  user_id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'supervisor' | 'operator';
  full_name: string | null;
  department_id: string | null;
  department_name: string | null;
}

// Rótulo de uma pessoa na UI. O e-mail sozinho não identifica ninguém quando as
// contas são sufixadas na mesma caixa; o setor desempata dois homônimos.
export function operatorLabel(o: Operator): string {
  const nome = o.full_name?.trim();
  if (!nome) return o.email;
  return o.department_name ? `${nome} — ${o.department_name}` : nome;
}

// Lista os membros da instância (via RPC list_operators) para o seletor de
// atribuição de conversas.
export function useOperators() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.schema('whatsapp_hub').rpc('list_operators');
      if (!cancelled) {
        setOperators((data ?? []) as Operator[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { operators, loading };
}
