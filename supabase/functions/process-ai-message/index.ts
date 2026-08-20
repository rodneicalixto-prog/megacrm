// ============================================================================
// process-ai-message
// ----------------------------------------------------------------------------
// Fired by the whatsapp_hub._on_inbound_message trigger every time a contact
// sends a message. The flow:
//
//   1. Load the message + conversation + agent config (singleton).
//   2. Bail if the AI should not answer (conversation.ai_paused, agent
//      config inactive, conversation closed, content_type not in
//      {text, image}).
//   3. Embed the inbound text via OpenAI to get a query vector (skipped for
//      an image with no caption).
//   4. RPC to whatsapp_hub.knowledge_search for the top-5 similar chunks.
//   5. Build a system + user prompt with system_prompt + RAG + chat history.
//   6. Call the configured LLM (env-supplied).
//   7. POST the reply to Meta's session-messages endpoint.
//   8. Insert an outbound row with sender_type='ai' + meta_status.
//
// Any failure downstream is logged, persisted in the row, and NOT retried
// automatically here — future module can add a DLQ.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { callLLM, type LLMProvider } from '../_shared/llm.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';
import { createInboxConversation, loadZernioContext, sendInboxMessage } from '../_shared/zernio.ts';
import { applyVariables, extractHandoff, extractMedia } from '../_shared/ai-reply.ts';
import { buildScheduleVars } from '../_shared/business-hours.ts';
import { isEvolutionChannel, sendEvolutionMessage } from '../_shared/whatsapp/outbound.ts';
import { maybeAutoMoveLead, type AutoMoveResult } from '../_shared/auto-move-lead.ts';

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
}

interface AgentConfig {
  system_prompt: string | null;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
  active_whatsapp: boolean;
  active_instagram: boolean;
  auto_move_leads: boolean;
  model: string | null;
  timezone: string | null;
  variables: Record<string, string> | null;
}

// ---- Horário de atendimento → variáveis automáticas -----------------------
// A IA recebe o horário atual, se está dentro do expediente e a mensagem de
// fora-do-horário (já preenchida) como variáveis. O prompt decide usá-las
// (tipicamente só no handoff fora do horário). Não há gate no código.

// Substitui {chave} pelos valores das variáveis do agente. Chaves desconhecidas
// ficam intactas (para não quebrar texto que use {} por outros motivos).
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

  // Guard: this function is only meant to run on inbound text/image from a contact.
  if (message.direction !== 'inbound' || message.sender_type !== 'contact') {
    return jsonResponse({ ok: true, skipped: 'not an inbound contact message' });
  }
  // Texto: precisa de content. Imagem: precisa de media_url (legenda em
  // content é opcional) — o LLM recebe a imagem como bloco de visão, ver
  // _shared/llm.ts. Áudio já chega com transcrição em content via
  // transcribe-audio, mas content_type permanece 'audio' (o trigger
  // on_audio_inbound só roda no INSERT original, sem legenda de texto ainda;
  // a UPDATE que grava a transcrição não re-dispara o trigger de IA — gap
  // conhecido, fora do escopo desta mudança). Vídeo/documento seguem sem
  // suporte.
  const isText = message.content_type === 'text' && !!message.content;
  const isImage = message.content_type === 'image' && !!message.media_url;
  if (!isText && !isImage) {
    return jsonResponse({ ok: true, skipped: `content_type=${message.content_type}` });
  }

  // 2. Load conversation + agent config (singleton).
  const [{ data: convRow }, { data: agentRow }] = await Promise.all([
    admin
      .from('conversations')
      .select('id, contact_id, status, ai_paused, channel, zernio_conversation_id, department_id, connection_id')
      .eq('id', message.conversation_id)
      .maybeSingle(),
    admin
      .from('ai_agent_config')
      .select('system_prompt, temperature, max_tokens, is_active, active_whatsapp, active_instagram, auto_move_leads, model, timezone, variables')
      .maybeSingle(),
  ]);
  if (!convRow) {
    return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
  }
  const conversation = convRow as ConversationRow;
  const agent = (agentRow as AgentConfig | null) ?? null;

  if (conversation.status === 'closed') {
    return jsonResponse({ ok: true, skipped: 'conversation closed' });
  }
  if (conversation.ai_paused) {
    return jsonResponse({ ok: true, skipped: 'ai paused' });
  }

  // Gate por canal (Módulo 6): se o agente está desligado para o canal desta
  // conversa, a IA não responde — a conversa vai direto para atendimento
  // humano (status human_active + ai_paused true, que dispara a notificação
  // de handoff aos operadores). É reversível: o operador pode retomar a IA.
  const channel = conversation.channel === 'instagram' ? 'instagram' : 'whatsapp';
  const channelEnabled =
    channel === 'instagram'
      ? (agent?.active_instagram ?? false)
      : (agent?.active_whatsapp ?? true);
  if (agent && !channelEnabled) {
    await admin
      .from('conversations')
      .update({ status: 'human_active', ai_paused: true, last_message_at: new Date().toISOString() })
      .eq('id', conversation.id);
    return jsonResponse({ ok: true, skipped: `ai disabled for channel ${channel}`, routed_to_human: true });
  }

  if (!agent || agent.is_active === false) {
    return jsonResponse({ ok: true, skipped: 'ai agent disabled' });
  }

  // 3. Credentials.
  const creds = await loadAppCredentials();
  if (!creds.openai_api_key) {
    return jsonResponse({ ok: false, error: 'Credencial openai_api_key nao configurada. Acesse /settings/credentials.' }, { status: 400 });
  }
  const provider: LLMProvider | null = creds.llm_provider;
  const llmKey = creds.llm_api_key;
  if (!provider || !llmKey) {
    return jsonResponse({ ok: false, error: 'Credenciais llm_provider/llm_api_key nao configuradas. Acesse /settings/credentials.' }, { status: 400 });
  }

  // 4. Embed the inbound text — para imagem sem legenda não há texto pra
  //    embedar, então a busca RAG simplesmente fica vazia (a IA ainda
  //    responde, só sem contexto recuperado).
  const embedSource = message.content?.trim() || '';
  let queryEmbedding: number[] = [];
  if (embedSource) {
    try {
      queryEmbedding = await embed(creds.openai_api_key, embedSource);
    } catch (err) {
      return jsonResponse(
        { ok: false, error: `embed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
  }

  // 5. Top-K RAG chunks (cosine similarity). Empty array is fine — the
  //    agent still answers, just without retrieved context.
  let ragChunks: string[] = [];
  if (queryEmbedding.length) {
    const { data: ragRows } = await admin.rpc('knowledge_search', {
      p_query_embedding: queryEmbedding,
      p_top_k: TOP_K,
    });
    ragChunks = ((ragRows ?? []) as Array<{ content: string; similarity: number }>).map((r) => r.content);
  }

  // 6. History — last N messages in this conversation, oldest first.
  const { data: historyRows } = await admin
    .from('messages')
    .select('id, conversation_id, direction, sender_type, content_type, content, is_private_note, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = ((historyRows ?? []) as MessageRow[]).reverse();

  // 7. LLM call. Resolve as variáveis {chave} do prompt e injeta o nome do
  //    contato quando disponível.
  const { data: contactNameRow } = await admin
    .from('contacts')
    .select('name')
    .eq('id', conversation.contact_id)
    .maybeSingle();
  const firstName = ((contactNameRow as { name?: string } | null)?.name ?? '').trim().split(/\s+/)[0] || '';

  // Variáveis automáticas de horário (horário atual, dentro/fora do expediente,
  // mensagem de fora-do-horário já preenchida) — o prompt decide quando usar.
  const { data: settingsRow } = await admin
    .from('app_settings')
    .select('business_hours, out_of_hours_message')
    .eq('id', 1)
    .maybeSingle();
  const scheduleVars = buildScheduleVars(
    agent.timezone ?? 'America/Sao_Paulo',
    (settingsRow as { business_hours?: unknown } | null)?.business_hours,
    (settingsRow as { out_of_hours_message?: string | null } | null)?.out_of_hours_message ?? null,
  );

  // Mídias do agente: lista para o prompt ({midias_disponiveis}) e mapa
  // rótulo→mídia para resolver os marcadores [MEDIA:rotulo].
  const { data: mediaRows } = await admin
    .from('ai_agent_media')
    .select('label, media_url, content_type, usage_note');
  const mediaList = (mediaRows ?? []) as Array<{
    label: string; media_url: string; content_type: string; usage_note: string | null;
  }>;
  const mediaByLabel = new Map(mediaList.map((m) => [m.label.toLowerCase(), m]));
  const midiasDisponiveis = mediaList.length
    ? mediaList
        .map((m) => `[MEDIA:${m.label}] (${m.content_type})${m.usage_note ? ' — ' + m.usage_note : ''}`)
        .join('; ')
    : 'nenhuma';

  const vars = {
    ...(agent.variables ?? {}),
    nome_do_contato: firstName,
    ...scheduleVars,
    midias_disponiveis: midiasDisponiveis,
  };

  const basePrompt =
    agent.system_prompt?.trim() ||
    'Você é um assistente de atendimento via WhatsApp. Responda em português brasileiro, de forma objetiva e educada.';
  const systemPrompt = applyVariables(basePrompt, vars);
  // Para imagem, o texto do prompt vira um rótulo + legenda (se houver); a
  // imagem em si vai anexada via imageUrl (callLLM busca e converte pra
  // base64 — ver _shared/llm.ts).
  const inboundLabel = isImage
    ? `[Imagem enviada pelo cliente]${message.content?.trim() ? ` Legenda: "${message.content.trim()}"` : ''}`
    : (message.content ?? '');
  const userPrompt = buildUserPrompt(history, ragChunks, inboundLabel);

  let reply: string;
  try {
    const result = await callLLM({
      provider,
      apiKey: llmKey,
      model: agent.model ?? undefined,
      systemPrompt,
      userPrompt,
      temperature: agent.temperature ?? 0.7,
      maxTokens: agent.max_tokens ?? 1000,
      imageUrl: isImage ? (message.media_url ?? undefined) : undefined,
    });
    reply = result.content.trim();
    if (!reply) throw new Error('LLM retornou resposta vazia.');
  } catch (err) {
    return jsonResponse(
      { ok: false, error: `llm: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Marcadores: [MEDIA:rotulo] (envia mídias) e [HANDOFF] (transfere). Remove
  // ambos do texto antes de enviar.
  const mediaExtract = extractMedia(reply);
  const { text: cleanedText, handoff } = extractHandoff(mediaExtract.text);
  const mediaToSend = mediaExtract.labels
    .map((l) => mediaByLabel.get(l))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  // Texto: o que sobrou; se vazio mas houve handoff, usa despedida; se vazio e
  // só houve mídia, não envia texto.
  const textBody = cleanedText.trim()
    ? cleanedText.trim()
    : handoff
      ? 'Perfeito! Vou te transferir para um especialista do time aqui mesmo nesta conversa. 🙌'
      : '';

  // Handoff: pausa a IA e marca a conversa p/ atendimento humano (o trigger
  // _on_handoff_notify notifica os operadores quando ai_paused vira true).
  await admin
    .from('conversations')
    .update(
      handoff
        ? { last_message_at: new Date().toISOString(), status: 'human_active', ai_paused: true }
        : { last_message_at: new Date().toISOString() },
    )
    .eq('id', conversation.id);

  // 9a. Conversas do canal 'evolution' respondem pela Evolution API (coexiste
  // com o WABA/Zernio — cada conversa sai por onde a mensagem chegou).
  if (isEvolutionChannel(conversation.channel)) {
    const { data: contactRow } = await admin
      .from('contacts').select('phone').eq('id', conversation.contact_id).maybeSingle();
    const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
    if (!phone) {
      return jsonResponse({ ok: true, sent: false, error: 'Contato sem telefone.' });
    }
    let uazTextId: string | null = null;
    let evoError: string | null = null;
    if (textBody) {
      const { data: ins } = await admin
        .from('messages')
        .insert({ conversation_id: conversation.id, direction: 'outbound', sender_type: 'ai', content_type: 'text', content: textBody, is_private_note: false })
        .select('id').single();
      const outboundId = (ins as { id: string } | null)?.id ?? null;
      try {
        const sent = await sendEvolutionMessage(phone, textBody, null, undefined, conversation.connection_id);
        uazTextId = sent.messageId;
        if (outboundId) await admin.from('messages').update({ meta_status: 'sent', zernio_message_id: sent.messageId ? `evolution:${sent.messageId}` : null }).eq('id', outboundId);
      } catch (err) {
        evoError = err instanceof Error ? err.message : 'Erro ao enviar via Evolution.';
        if (outboundId) await admin.from('messages').update({ meta_status: 'failed' }).eq('id', outboundId);
      }
    }
    let uazMediaSent = 0;
    for (const m of mediaToSend) {
      const { data: mIns } = await admin
        .from('messages')
        .insert({ conversation_id: conversation.id, direction: 'outbound', sender_type: 'ai', content_type: m.content_type, content: null, media_url: m.media_url, is_private_note: false })
        .select('id').single();
      const mId = (mIns as { id: string } | null)?.id ?? null;
      try {
        const sent = await sendEvolutionMessage(phone, '', m.media_url, m.content_type, conversation.connection_id);
        if (mId) await admin.from('messages').update({ meta_status: 'sent', zernio_message_id: sent.messageId ? `evolution:${sent.messageId}` : null }).eq('id', mId);
        uazMediaSent++;
      } catch (_err) {
        if (mId) await admin.from('messages').update({ meta_status: 'failed' }).eq('id', mId);
      }
    }
    await admin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);
    return jsonResponse({
      ok: true,
      sent_via: conversation.channel,
      text_message_id: uazTextId,
      media_sent: uazMediaSent,
      ...(evoError ? { evolution_error: evoError } : {}),
    });
  }

  // 9. Envia via Zernio. Resolve/garante a conversa 1:1 uma vez (texto + mídias).
  let ctx: Awaited<ReturnType<typeof loadZernioContext>>;
  try {
    ctx = await loadZernioContext();
  } catch (err) {
    return jsonResponse({ ok: true, sent_to_zernio: false, zernio_error: err instanceof Error ? err.message : 'Credenciais Zernio ausentes.' });
  }

  let zConvId = conversation.zernio_conversation_id;
  if (!zConvId) {
    const { data: contactRow } = await admin
      .from('contacts').select('phone').eq('id', conversation.contact_id).maybeSingle();
    const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
    if (phone) {
      try {
        const created = await createInboxConversation({ apiKey: ctx.apiKey, accountId: ctx.accountId, participantId: phone });
        zConvId = created.conversationId;
        if (zConvId) await admin.from('conversations').update({ zernio_conversation_id: zConvId }).eq('id', conversation.id);
      } catch (_err) { /* tratado abaixo */ }
    }
  }
  if (!zConvId) {
    return jsonResponse({ ok: true, sent_to_zernio: false, zernio_error: 'Não foi possível resolver a conversa no Zernio.' });
  }

  // Texto (persiste + envia) — só se houver.
  let textMessageId: string | null = null;
  let textError: string | null = null;
  if (textBody) {
    const { data: ins } = await admin
      .from('messages')
      .insert({ conversation_id: conversation.id, direction: 'outbound', sender_type: 'ai', content_type: 'text', content: textBody, is_private_note: false })
      .select('id').single();
    const outboundId = (ins as { id: string } | null)?.id ?? null;
    try {
      const sent = await sendInboxMessage({ apiKey: ctx.apiKey, accountId: ctx.accountId, conversationId: zConvId, text: textBody });
      textMessageId = sent.messageId;
      if (outboundId) await admin.from('messages').update({ meta_status: 'sent', zernio_message_id: sent.messageId }).eq('id', outboundId);
    } catch (err) {
      textError = err instanceof Error ? err.message : 'Erro ao enviar via Zernio.';
      if (outboundId) await admin.from('messages').update({ meta_status: 'failed' }).eq('id', outboundId);
    }
  }

  // Mídias (cada uma persiste + envia com attachmentUrl = URL pública).
  let mediaSent = 0;
  for (const m of mediaToSend) {
    const attachmentType =
      (['image', 'video', 'audio'].includes(m.content_type) ? m.content_type : 'file') as 'image' | 'video' | 'audio' | 'file';
    const { data: mIns } = await admin
      .from('messages')
      .insert({ conversation_id: conversation.id, direction: 'outbound', sender_type: 'ai', content_type: m.content_type, content: null, media_url: m.media_url, is_private_note: false })
      .select('id').single();
    const mId = (mIns as { id: string } | null)?.id ?? null;
    try {
      const sent = await sendInboxMessage({ apiKey: ctx.apiKey, accountId: ctx.accountId, conversationId: zConvId, attachmentUrl: m.media_url, attachmentType });
      if (mId) await admin.from('messages').update({ meta_status: 'sent', zernio_message_id: sent.messageId }).eq('id', mId);
      mediaSent++;
    } catch (_err) {
      if (mId) await admin.from('messages').update({ meta_status: 'failed' }).eq('id', mId);
    }
  }

  await admin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);

  // Módulo 8: IA move o lead pelo funil (com sinal claro). Só quando o toggle
  // está ligado; o gate de canal já barrou canais desligados acima. Nunca
  // interrompe o fluxo principal.
  let autoMove: AutoMoveResult = { moved: false, skipped: 'disabled' };
  if (agent.auto_move_leads !== false) {
    try {
      const transcript = history
        .filter((m) => !m.is_private_note && m.content)
        .map((m) => {
          const who = m.sender_type === 'contact' ? 'Cliente' : m.sender_type === 'ai' ? 'Assistente' : m.sender_type === 'operator' ? 'Atendente' : 'Sistema';
          return `[${who}] ${m.content}`;
        })
        .join('\n');
      autoMove = await maybeAutoMoveLead(admin, {
        provider,
        apiKey: llmKey,
        model: agent.model ?? undefined,
        contactId: conversation.contact_id,
        transcript,
      });
    } catch (err) {
      autoMove = { moved: false, skipped: `error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return jsonResponse({
    ok: true,
    sent_to_zernio: !textError,
    zernio_message_id: textMessageId,
    media_sent: mediaSent,
    rag_chunks: ragChunks.length,
    handoff,
    auto_move: autoMove,
    zernio_error: textError ?? undefined,
  });
});
