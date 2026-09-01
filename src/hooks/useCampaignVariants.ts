import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { CampaignVariant } from '@/types/campaigns';

// Variantes de teste A/B por campanha (PLANEJAMENTO.md Onda 3). Busca todas
// de uma vez para a lista de campanhas visível — a tabela é pequena (poucas
// variantes por campanha), não precisa de paginação.
export function useCampaignVariants(campaignIds: string[]) {
  const [byCampaign, setByCampaign] = useState<Map<string, CampaignVariant[]>>(new Map());

  const key = campaignIds.join(',');
  useEffect(() => {
    if (campaignIds.length === 0) {
      setByCampaign(new Map());
      return;
    }
    let cancelled = false;
    void getSupabase()
      .from('campaign_variants')
      .select('*')
      .in('campaign_id', campaignIds)
      .then(({ data }) => {
        if (cancelled) return;
        const map = new Map<string, CampaignVariant[]>();
        for (const row of (data ?? []) as CampaignVariant[]) {
          const list = map.get(row.campaign_id) ?? [];
          list.push(row);
          map.set(row.campaign_id, list);
        }
        setByCampaign(map);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return byCampaign;
}
