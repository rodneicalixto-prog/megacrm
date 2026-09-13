import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface Operator {
  user_id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'supervisor' | 'operator';
  full_name: string | null;
  department_id: string | null;
  department_name: string | null;
  is_online: boolean;
  last_seen_at: string | null;
}

// Rótulo de uma pessoa na UI. O e-mail sozinho não identifica ninguém quando as
// contas são sufixadas na mesma caixa; o setor desempata dois homônimos.
export function operatorLabel(o: Operator): string {
  const nome = o.full_name?.trim();
  if (!nome) return o.email;
  return o.department_name ? `${nome} — ${o.department_name}` : nome;
}

// Reconsulta a presença (is_online/last_seen_at) periodicamente. O heartbeat
// em AppUserProvider.tsx já grava a cada 45s; sem isso, quem abriu esta tela
// antes de um colega logar via app ficava com "Offline" preso até dar F5 —
// o fetch original só rodava uma vez no mount.
const REFRESH_INTERVAL_MS = 30_000;

// Lista os membros da instância (via RPC list_operators) para o seletor de
// atribuição de conversas.
export function useOperators() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();

    const load = async () => {
      const { data, error: err } = await supabase.schema('whatsapp_hub').rpc('list_operators');
      if (cancelled) return;
      if (err) {
        console.error('[useOperators] falha ao listar operadores', err);
        setError(err.message);
        setLoading(false);
        return;
      }
      setError(null);
      setOperators((data ?? []) as Operator[]);
      setLoading(false);
    };

    void load();
    const interval = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return { operators, loading, error };
}
