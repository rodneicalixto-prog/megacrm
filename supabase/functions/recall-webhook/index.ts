// recall-webhook — (público) recebe o aviso da Recall.ai de que um bot mudou
// de status. Não confiamos no corpo do evento pra decidir o que fazer: ele só
// diz QUAL bot mudou; buscamos o status/gravação real via GET /bot/{id}/
// (fetchRecallBotStatus) antes de agir — assim o handler sobrevive a
// variações no formato exato do payload entre versões da API da Recall.ai.
//
// Autenticação: shared secret na query string (?token=), configurada em
// /settings/credentials (recall_webhook_secret) e colada na mesma URL no
// painel da Recall.ai — mesmo padrão do webhook da Evolution, que também não
// suporta assinatura HMAC própria de forma simples de configurar aqui.
//
// ASSUMIDO: nomes de evento/campo do payload da Recall.ai — ver comentário em
// _shared/recall.ts. Só o bot_id é de fato lido do corpo; o resto vem da API.

import { getCredential } from '../_shared/credentials.ts';
import { secretMatches } from '../_shared/signature.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { asObject, str } from '../_shared/whatsapp/types.ts';
import { fetchRecallBotStatus, fetchRecallTranscript, formatTranscript } from '../_shared/recall.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { callLLM } from '../_shared/llm.ts';

const DONE_CODES = ['done', 'call_ended', 'analysis_done'];
const FAILED_CODES = ['fatal', 'error', 'call_ended_error'];
const RECORDING_CODES = ['in_call_recording', 'recording'];

const SUMMARY_SYSTEM_PROMPT =
  'Você resume transcrições de reuniões de trabalho em português do Brasil. ' +
  'Devolva um resumo objetivo com: (1) principais pontos discutidos, (2) decisões tomadas, ' +
  '(3) próximos passos / ações com responsável quando identificável. Sem rodeios, direto ao ponto.';

async function summarize(transcript: string): Promise<string | null> {
  try {
    const creds = await loadAppCredentials();
    if (!creds.llm_provider || !creds.llm_api_key) return null;
    const result = await callLLM({
      provider: creds.llm_provider,
      apiKey: creds.llm_api_key,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: transcript.slice(0, 60_000), // limite defensivo contra transcrições enormes
      maxTokens: 800,
    });
    return result.content.trim() || null;
  } catch (err) {
    console.log(JSON.stringify({ event: 'meeting_summary_failed', message: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(req.url);
  const expected = await getCredential('recall_webhook_secret');
  const received = url.searchParams.get('token') ?? '';
  if (!expected) {
    return jsonResponse({ ok: false, error: 'webhook Recall.ai sem segredo configurado' }, { status: 500 });
  }
  if (!secretMatches(received, expected)) {
    return jsonResponse({ ok: false, error: 'segredo de webhook inválido' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const root = asObject(payload);
  const data = asObject(root.data);
  const bot = asObject(data.bot);
  const botId = str(data, ['bot_id']) ?? str(bot, ['id']);
  if (!botId) {
    return jsonResponse({ ok: true, skipped: 'sem bot_id' });
  }

  const admin = getAdminClient();
  const { data: meetingRow } = await admin
    .from('meetings')
    .select('id, status')
    .eq('recall_bot_id', botId)
    .maybeSingle();
  if (!meetingRow) {
    return jsonResponse({ ok: true, skipped: 'reunião não encontrada pro bot' });
  }
  const meeting = meetingRow as { id: string; status: string };

  const botStatus = await fetchRecallBotStatus(botId);
  const statusCode = botStatus?.statusCode ?? null;

  if (statusCode && FAILED_CODES.includes(statusCode)) {
    await admin.from('meetings').update({
      status: 'failed',
      error_message: `Bot de gravação falhou (status: ${statusCode}).`,
    }).eq('id', meeting.id);
    return jsonResponse({ ok: true, meeting_id: meeting.id, status: 'failed' });
  }

  if (statusCode && RECORDING_CODES.includes(statusCode)) {
    await admin.from('meetings').update({ status: 'recording' }).eq('id', meeting.id);
    return jsonResponse({ ok: true, meeting_id: meeting.id, status: 'recording' });
  }

  if (statusCode && DONE_CODES.includes(statusCode)) {
    await admin.from('meetings').update({ status: 'processing' }).eq('id', meeting.id);

    const turns = await fetchRecallTranscript(botId);
    const transcript = turns && turns.length ? formatTranscript(turns) : null;
    const summary = transcript ? await summarize(transcript) : null;

    await admin.from('meetings').update({
      status: 'completed',
      recording_url: botStatus?.recordingUrl ?? null,
      transcript,
      summary,
    }).eq('id', meeting.id);

    return jsonResponse({ ok: true, meeting_id: meeting.id, status: 'completed', summarized: Boolean(summary) });
  }

  // Status intermediário sem ação mapeada (ex.: joining_call) — só confirma
  // recebido, sem mexer na linha.
  return jsonResponse({ ok: true, meeting_id: meeting.id, status: statusCode ?? 'unknown' });
});
