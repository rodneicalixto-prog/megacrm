// ============================================================================
// process-ai-message-stream
// ============================================================================
// SSE streaming variant of process-ai-message. Yields tokens in real-time
// instead of waiting for full response. Frontend reads with EventSource.
// Same flow as process-ai-message (embed, RAG, history, LLM) but with
// streaming transport.
//
// Request: POST /process-ai-message-stream with { message_id, conversation_id }
// Response: text/event-stream with events: { event: 'chunk', data: 'text' }
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { callLLMStream, type LLMProvider } from '../_shared/llm.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';
import { isModuleEnabled } from '../_shared/plan.ts';
import { applyVariables, extractHandoff, extractMedia } from '../_shared/ai-reply.ts';
import { buildScheduleVars } from '../_shared/business-hours.ts';

const EMBED_MODEL = 'text-embedding-3-small';
const TOP_K = 5;
const HISTORY_LIMIT = 20;

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'contact' | 'ai' | 'operator' | 'system';
  content_type: string;
  content: string | null;
  media_url: string | null;
  is_private_note: boolean;
  created_at: string;
}

interface ConversationRow {
  id: string;
  contact_id: string;
  status: 'ai_active' | 'human_active' | 'closed';
  ai_paused: boolean;
  department_id: string | null;
  connection_id: string | null;
  channel: string | null;
  zernio_conversation_id: string | null;
  assigned_to: string | null;
}

interface AgentConfig {
  id: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
  active_whatsapp: boolean;
  active_instagram: boolean;
  model?: string;
  timezone: string;
  variables?: Record<string, string>;
  traffic_pct?: number;
}

async function resolveBusinessHours(
  admin: ReturnType<typeof getAdminClient>,
  assignedTo: string | null,
  departmentId: string | null,
): Promise<{ business_hours: unknown; out_of_hours_message: string | null }> {
  if (assignedTo) {
    const { data } = await admin
      .from('app_users')
      .select('business_hours, out_of_hours_message')
      .eq('user_id', assignedTo)
      .maybeSingle();
    const row = data as { business_hours: unknown; out_of_hours_message: string | null } | null;
    if (row?.business_hours || row?.out_of_hours_message) return row;
  }
  if (departmentId) {
    const { data } = await admin
      .from('departments')
      .select('business_hours, out_of_hours_message')
      .eq('id', departmentId)
      .maybeSingle();
    const row = data as { business_hours: unknown; out_of_hours_message: string | null } | null;
    if (row?.business_hours || row?.out_of_hours_message) return row;
  }
  const { data: settingsRow } = await admin
    .from('app_settings')
    .select('business_hours, out_of_hours_message')
    .eq('id', 1)
    .maybeSingle();
  return (settingsRow as { business_hours: unknown; out_of_hours_message: string | null } | null)
    ?? { business_hours: null, out_of_hours_message: null };
}

async function embed(openaiKey: string, text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body?.data?.[0]?.embedding ?? [];
}

function buildUserPrompt(history: MessageRow[], ragChunks: string[], inbound: string): string {
  const historyText = history
    .filter((m) => !m.is_private_note && m.content)
    .map((m) => {
      const who =
        m.sender_type === 'contact'
          ? 'Cliente'
          : m.sender_type === 'ai'
            ? 'Assistente'
            : m.sender_type === 'operator'
              ? 'Atendente humano'
              : 'Sistema';
      return `[${who}] ${m.content}`;
    })
    .join('\n');

  const ragBlock = ragChunks.length
    ? `\n\nContexto relevante da base de conhecimento:\n${ragChunks.map((c, i) => `(${i + 1}) ${c}`).join('\n\n')}`
    : '';

  return [
    `Histórico da conversa (cronológico):\n${historyText}`,
    ragBlock,
    `\nMensagem atual do cliente:\n"${inbound}"`,
    `\nResponda em português brasileiro, de forma objetiva, baseado no contexto. Se não souber, diga que vai chamar um humano.`,
  ].join('\n');
}

function pickAgentVariant(candidates: AgentConfig[], contactId: string): AgentConfig | undefined {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  const hash = Array.from(contactId).reduce((h, c) => h + c.charCodeAt(0), 0);
  const traffic = candidates.map((a) => a.traffic_pct ?? 100);
  const cumulative: number[] = [];
  traffic.reduce((sum, pct) => {
    cumulative.push(sum);
    return sum + pct;
  }, 0);
  const slot = hash % (cumulative[cumulative.length - 1] || 100);
  return candidates[cumulative.findIndex((c) => c > slot)];
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireServiceRole(req);
  } catch {
    return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: { message_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  if (!body.message_id) {
    return jsonResponse({ ok: false, error: 'message_id ausente.' }, { status: 400 });
  }

  const admin = getAdminClient();

  // 1. Load triggering message.
  const { data: msgRow, error: msgErr } = await admin
    .from('messages')
    .select('id, conversation_id, direction, sender_type, content_type, content, media_url, is_private_note, created_at')
    .eq('id', body.message_id)
    .maybeSingle();
  if (msgErr || !msgRow) {
    return jsonResponse({ ok: false, error: 'Mensagem não encontrada.' }, { status: 404 });
  }
  const message = msgRow as MessageRow;

  // Guard: only on inbound text/image from a contact.
  if (message.direction !== 'inbound' || message.sender_type !== 'contact') {
    return new Response('event: skip\ndata: not_inbound\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  const isImage = message.content_type === 'image' && !!message.media_url;
  const isText = !!message.content && message.content_type === 'text';
  if (!isText && !isImage) {
    return new Response('event: skip\ndata: unsupported_type\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // 2. Load conversation + agent profiles.
  const [{ data: convRow }, { data: agentRows }] = await Promise.all([
    admin
      .from('conversations')
      .select('id, contact_id, status, ai_paused, channel, zernio_conversation_id, department_id, connection_id, assigned_to')
      .eq('id', message.conversation_id)
      .maybeSingle(),
    admin
      .from('ai_agent_config')
      .select('id, system_prompt, temperature, max_tokens, is_active, active_whatsapp, active_instagram, auto_move_leads, model, timezone, variables, traffic_pct')
      .eq('is_active', true),
  ]);
  if (!convRow) {
    return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
  }
  const conversation = convRow as ConversationRow;
  const allAgents = (agentRows ?? []) as AgentConfig[];

  if (conversation.status === 'closed') {
    return new Response('event: skip\ndata: conversation_closed\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  if (conversation.ai_paused) {
    return new Response('event: skip\ndata: ai_paused\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const channel = conversation.channel === 'instagram' ? 'instagram' : 'whatsapp';
  const channelCandidates = allAgents.filter((a) =>
    channel === 'instagram' ? a.active_instagram : a.active_whatsapp,
  );
  const agent = pickAgentVariant(channelCandidates, conversation.contact_id);

  if (!agent) {
    return new Response('event: skip\ndata: no_agent\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  if (!(await isModuleEnabled('ai_agent'))) {
    return new Response('event: skip\ndata: module_disabled\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // 3. Credentials.
  const creds = await loadAppCredentials();
  if (!creds.openai_api_key || !creds.llm_provider || !creds.llm_api_key) {
    return jsonResponse({ ok: false, error: 'Credenciais não configuradas.' }, { status: 400 });
  }

  // 4. Embed.
  const embedSource = message.content?.trim() || '';
  let queryEmbedding: number[] = [];
  if (embedSource) {
    try {
      queryEmbedding = await embed(creds.openai_api_key, embedSource);
    } catch (err) {
      return jsonResponse({ ok: false, error: `embed failed` }, { status: 502 });
    }
  }

  // 5. RAG.
  let ragChunks: string[] = [];
  if (queryEmbedding.length) {
    const { data: ragRows } = await admin.rpc('knowledge_search', {
      p_query_embedding: queryEmbedding,
      p_top_k: TOP_K,
    });
    ragChunks = ((ragRows ?? []) as Array<{ content: string; similarity: number }>).map((r) => r.content);
  }

  // 6. History.
  const { data: historyRows } = await admin
    .from('messages')
    .select('id, conversation_id, direction, sender_type, content_type, content, is_private_note, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = ((historyRows ?? []) as MessageRow[]).reverse();

  // 7. Contact name + schedule vars.
  const { data: contactNameRow } = await admin
    .from('contacts')
    .select('name')
    .eq('id', conversation.contact_id)
    .maybeSingle();
  const firstName = ((contactNameRow as { name?: string } | null)?.name ?? '').trim().split(/\s+/)[0] || '';

  const businessHoursRow = await resolveBusinessHours(admin, conversation.assigned_to, conversation.department_id);
  const scheduleVars = buildScheduleVars(
    agent.timezone ?? 'America/Sao_Paulo',
    businessHoursRow.business_hours,
    businessHoursRow.out_of_hours_message,
  );

  const { data: mediaRows } = await admin
    .from('ai_agent_media')
    .select('label, media_url, content_type, usage_note');
  const mediaList = (mediaRows ?? []) as Array<{
    label: string; media_url: string; content_type: string; usage_note: string | null;
  }>;
  const mediaByLabel = new Map(mediaList.map((m) => [m.label.toLowerCase(), m]));

  const vars = {
    ...(agent.variables ?? {}),
    nome_do_contato: firstName,
    ...scheduleVars,
    midias_disponiveis: mediaList.length ? mediaList.map((m) => `[MEDIA:${m.label}]`).join('; ') : 'nenhuma',
  };

  const basePrompt =
    agent.system_prompt?.trim() ||
    'Você é um assistente de atendimento via WhatsApp. Responda em português brasileiro, de forma objetiva e educada.';
  const systemPrompt = applyVariables(basePrompt, vars);
  const inboundLabel = isImage
    ? `[Imagem enviada pelo cliente]${message.content?.trim() ? ` Legenda: "${message.content.trim()}"` : ''}`
    : (message.content ?? '');
  const userPrompt = buildUserPrompt(history, ragChunks, inboundLabel);

  // 8. Stream response via SSE.
  const { readable, writable } = new TransformStream<string, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Fire-and-forget: stream tokens in background while returning SSE immediately.
  (async () => {
    try {
      let fullText = '';
      const provider: LLMProvider = creds.llm_provider as LLMProvider;
      for await (const chunk of callLLMStream({
        provider,
        apiKey: creds.llm_api_key,
        model: agent.model ?? undefined,
        systemPrompt,
        userPrompt,
        temperature: agent.temperature ?? 0.7,
        maxTokens: agent.max_tokens ?? 1000,
        imageUrl: isImage ? (message.media_url ?? undefined) : undefined,
      })) {
        fullText += chunk;
        await writer.write(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
      }

      // Post-processing: extract handoff, media, etc.
      const mediaExtract = extractMedia(fullText);
      const { text: cleanedText, handoff } = extractHandoff(mediaExtract.text);

      // Send final event with processed response.
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        done: true,
        text: cleanedText.trim(),
        handoff,
        mediaLabels: mediaExtract.labels,
      })}\n\n`));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN')?.trim() || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
});

function buildScheduleVars(
  timezone: string,
  businessHours: unknown,
  outOfHoursMessage: string | null,
): Record<string, string> {
  // Simplified schedule vars — full version in process-ai-message
  return {
    hora_atual: new Date().toLocaleTimeString('pt-BR', { timeZone: timezone }),
    mensagem_fora_de_horario: outOfHoursMessage ?? 'Fora do horário de atendimento',
  };
}
