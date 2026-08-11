import { parseJsonLoose } from './ai-reply.ts';
import { callLLM, type LLMProvider } from './llm.ts';
import { getAdminClient } from './supabase-admin.ts';

export interface AutoMoveResult {
  moved: boolean;
  skipped?: string;
  to?: string;
  reason?: string;
}

// Módulo 8 — parâmetros do movimento automático de estágio pela IA.
const AUTO_MOVE_COOLDOWN_MS = 15 * 60 * 1000; // evita mover várias vezes em sequência
const AUTO_MOVE_MIN_CONFIDENCE = 0.7;         // só move com sinal claro

interface AutoMoveDeps {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  contactId: string;
  transcript: string;
}

// Avalia se o lead avançou de estágio no funil comercial e, com sinal claro,
// move o deal e registra em lead_stage_history (moved_by='ia'). Respeita
// cooldown e só considera estágios COM ai_criteria. Nunca lança — falhas viram
// { moved:false }.
export async function maybeAutoMoveLead(
  admin: ReturnType<typeof getAdminClient>,
  d: AutoMoveDeps,
): Promise<AutoMoveResult> {
  // 1. Deal aberto no funil comercial deste contato.
  const { data: dealRows } = await admin
    .from('deals')
    .select('id, stage_id, pipeline_id, pipelines:pipeline_id(kind)')
    .eq('contact_id', d.contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false });
  const deal = ((dealRows ?? []) as Array<{
    id: string; stage_id: string | null; pipeline_id: string | null; pipelines: { kind?: string } | null;
  }>).find((x) => (x.pipelines?.kind ?? 'comercial') === 'comercial');
  if (!deal || !deal.pipeline_id) return { moved: false, skipped: 'no open commercial deal' };

  // 2. Estágios do funil; candidatos são os que têm ai_criteria.
  const { data: stageRows } = await admin
    .from('stages')
    .select('id, name, position, is_won, is_lost, ai_criteria')
    .eq('pipeline_id', deal.pipeline_id)
    .order('position');
  const stages = (stageRows ?? []) as Array<{
    id: string; name: string; is_won: boolean; is_lost: boolean; ai_criteria: string | null;
  }>;
  const candidates = stages.filter((s) => s.ai_criteria && s.ai_criteria.trim());
  if (candidates.length === 0) return { moved: false, skipped: 'no ai_criteria on stages' };

  // 3. Cooldown: sem outro movimento da IA neste deal na janela recente.
  const { data: lastMove } = await admin
    .from('lead_stage_history')
    .select('created_at')
    .eq('deal_id', deal.id)
    .eq('moved_by', 'ia')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastMove && Date.now() - new Date((lastMove as { created_at: string }).created_at).getTime() < AUTO_MOVE_COOLDOWN_MS) {
    return { moved: false, skipped: 'cooldown' };
  }

  // 4. Classificação via LLM (JSON estrito, temperatura 0).
  const currentStage = stages.find((s) => s.id === deal.stage_id);
  const stageList = candidates.map((s) => `- id=${s.id} | ${s.name}: ${s.ai_criteria}`).join('\n');
  const sys =
    'Você classifica em qual estágio de funil um lead está, a partir da conversa. ' +
    'Responda SOMENTE com JSON válido, sem texto fora do JSON.';
  const user =
    `Estágio atual do lead: ${currentStage?.name ?? 'desconhecido'} (id=${deal.stage_id ?? 'null'}).\n\n` +
    `Estágios candidatos (escolha só entre estes ids):\n${stageList}\n\n` +
    `Conversa (cronológica):\n${d.transcript}\n\n` +
    `Regras: escolha o estágio cujo critério esteja CLARAMENTE satisfeito pela conversa. ` +
    `Se ambíguo ou sem sinal claro, NÃO mova (retorne stage_id null). Nunca invente ids.\n` +
    `Responda JSON: {"stage_id": "<id ou null>", "confidence": <0..1>, "reason": "<motivo curto>"}`;

  let content: string;
  try {
    const res = await callLLM({
      provider: d.provider, apiKey: d.apiKey, model: d.model,
      systemPrompt: sys, userPrompt: user, temperature: 0, maxTokens: 200,
    });
    content = res.content;
  } catch (err) {
    return { moved: false, skipped: `llm: ${err instanceof Error ? err.message : String(err)}` };
  }

  const parsed = parseJsonLoose(content);
  if (!parsed) return { moved: false, skipped: 'parse' };
  const stageId = typeof parsed.stage_id === 'string' ? parsed.stage_id : null;
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  if (!stageId || stageId === deal.stage_id) return { moved: false, skipped: 'no change' };
  if (!candidates.some((s) => s.id === stageId)) return { moved: false, skipped: 'invalid stage id' };
  if (confidence < AUTO_MOVE_MIN_CONFIDENCE) return { moved: false, skipped: `low confidence ${confidence}` };

  // 5. Move o deal + registra no histórico. status acompanha estágio ganho/perdido.
  const target = stages.find((s) => s.id === stageId)!;
  const nextStatus = target.is_won ? 'won' : target.is_lost ? 'lost' : 'open';
  await admin.from('deals').update({ stage_id: stageId, status: nextStatus }).eq('id', deal.id);
  await admin.from('lead_stage_history').insert({
    deal_id: deal.id,
    from_stage_id: deal.stage_id,
    to_stage_id: stageId,
    moved_by: 'ia',
    reason: reason.slice(0, 300),
  });
  return { moved: true, to: stageId, reason };
}

