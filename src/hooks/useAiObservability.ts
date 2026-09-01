import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface AiObservability {
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  feedbackUp: number;
  feedbackDown: number;
}

const EMPTY: AiObservability = { messages: 0, tokensInput: 0, tokensOutput: 0, costUsd: 0, feedbackUp: 0, feedbackDown: 0 };

// Observabilidade da IA (PLANEJAMENTO.md Onda 3) — agrega tokens/custo/feedback
// das respostas da IA (messages.sender_type='ai') nos últimos `days` dias.
export function useAiObservability(days = 7) {
  const [data, setData] = useState<AiObservability>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    void getSupabase()
      .from('messages')
      .select('tokens_input, tokens_output, cost_usd, feedback')
      .eq('sender_type', 'ai')
      .gte('created_at', since)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const acc = ((rows ?? []) as Array<{ tokens_input: number | null; tokens_output: number | null; cost_usd: number | null; feedback: string | null }>)
          .reduce((sum, r) => {
            sum.messages += 1;
            sum.tokensInput += r.tokens_input ?? 0;
            sum.tokensOutput += r.tokens_output ?? 0;
            sum.costUsd += r.cost_usd ?? 0;
            if (r.feedback === 'up') sum.feedbackUp += 1;
            if (r.feedback === 'down') sum.feedbackDown += 1;
            return sum;
          }, { ...EMPTY });
        setData(acc);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [days]);

  return { data, loading };
}

// Comparação por perfil de IA (PLANEJAMENTO.md Onda 4) — mesma agregação de
// useAiObservability, mas agrupada por ai_config_id em vez de somada. Usada
// no painel de comparação A/B/C/D de AIAgentSettings.
export function useAiObservabilityByProfile(days = 30) {
  const [byProfile, setByProfile] = useState<Map<string, AiObservability>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    void getSupabase()
      .from('messages')
      .select('ai_config_id, tokens_input, tokens_output, cost_usd, feedback')
      .eq('sender_type', 'ai')
      .not('ai_config_id', 'is', null)
      .gte('created_at', since)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const map = new Map<string, AiObservability>();
        for (const r of (rows ?? []) as Array<{
          ai_config_id: string | null; tokens_input: number | null; tokens_output: number | null; cost_usd: number | null; feedback: string | null;
        }>) {
          if (!r.ai_config_id) continue;
          const acc = map.get(r.ai_config_id) ?? { ...EMPTY };
          acc.messages += 1;
          acc.tokensInput += r.tokens_input ?? 0;
          acc.tokensOutput += r.tokens_output ?? 0;
          acc.costUsd += r.cost_usd ?? 0;
          if (r.feedback === 'up') acc.feedbackUp += 1;
          if (r.feedback === 'down') acc.feedbackDown += 1;
          map.set(r.ai_config_id, acc);
        }
        setByProfile(map);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [days]);

  return { byProfile, loading };
}
