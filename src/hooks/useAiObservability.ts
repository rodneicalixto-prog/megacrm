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
