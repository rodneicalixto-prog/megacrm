import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

// Nome e logo da empresa. Lido em toda carga de página (sidebar, mobile nav,
// título), então o resultado fica em memória no módulo — trocar de rota não
// precisa perguntar de novo ao banco.

export interface Branding {
  companyName: string | null;
  logoUrl: string | null;
}

const FALLBACK: Branding = { companyName: null, logoUrl: null };

let cache: Branding | null = null;
const listeners = new Set<(b: Branding) => void>();

export function primeBranding(next: Branding) {
  cache = next;
  for (const fn of listeners) fn(next);
}

export async function fetchBranding(): Promise<Branding> {
  const { data } = await getSupabase()
    .schema('whatsapp_hub')
    .from('app_settings')
    .select('company_name, logo_url')
    .limit(1)
    .maybeSingle();

  const row = data as { company_name?: string | null; logo_url?: string | null } | null;
  return { companyName: row?.company_name ?? null, logoUrl: row?.logo_url ?? null };
}

export function useBranding() {
  const [branding, setBranding] = useState<Branding>(cache ?? FALLBACK);

  const reload = useCallback(async () => {
    try {
      primeBranding(await fetchBranding());
    } catch {
      // Marca é decoração: falhar aqui não pode derrubar a navegação.
    }
  }, []);

  useEffect(() => {
    listeners.add(setBranding);
    if (cache === null) void reload();
    return () => {
      listeners.delete(setBranding);
    };
  }, [reload]);

  return { branding, reload };
}
