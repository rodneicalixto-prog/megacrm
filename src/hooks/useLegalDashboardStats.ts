import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { LegalDashboardStats } from '@/types/legal';

export function useLegalDashboardStats() {
  const [stats, setStats] = useState<LegalDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await getSupabase().schema('whatsapp_hub').rpc('legal_dashboard_stats');
      if (cancelled) return;
      if (err) {
        console.error('[useLegalDashboardStats] falha ao carregar painel', err);
        setError(err.message);
      } else {
        setStats(data as LegalDashboardStats);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, loading, error };
}
