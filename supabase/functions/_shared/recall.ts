// Cliente Recall.ai — bot que entra numa chamada de vídeo (Google Meet/Zoom/
// Teams) pra gravar e transcrever. Escolhido em vez de Fireflies/Otter porque
// é API-first (dá pra plugar num CRM próprio); os outros são produtos
// fechados com UI própria, sem uma API pública equivalente.
//
// ASSUMIDO: o shape exato do payload de webhook (bot.status_change vs
// transcript.done, nomes de campo em `data`) segue a doc pública da Recall.ai
// no momento em que este arquivo foi escrito, mas não foi validado contra uma
// conta real — confirmar no primeiro teste de integração e ajustar
// recall-webhook/index.ts se os campos vierem diferentes.

import { getCredential } from './credentials.ts';

const RECALL_API_BASE = 'https://api.recall.ai/api/v1';

export async function loadRecallApiKey(): Promise<string | null> {
  const key = await getCredential('recall_api_key');
  return key?.trim() || null;
}

export interface CreateBotInput {
  meetingUrl: string;
  joinAtIso: string; // horário de início da reunião — o bot entra nesse horário
  botName?: string;
}

export interface CreateBotResult {
  botId: string;
}

export async function createRecallBot(input: CreateBotInput): Promise<CreateBotResult | null> {
  const apiKey = await loadRecallApiKey();
  if (!apiKey) return null; // gravação é opcional — sem chave, só não agenda o bot

  const res = await fetch(`${RECALL_API_BASE}/bot/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: input.meetingUrl,
      join_at: input.joinAtIso,
      bot_name: input.botName ?? 'MegaCRM Notetaker',
      // Transcrição via legendas da própria chamada — não depende de um
      // provedor de STT pago adicional na Recall.ai.
      recording_config: {
        transcript: { provider: { meeting_captions: {} } },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Recall.ai HTTP ${res.status}: ${body}`);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error('Recall.ai não devolveu o id do bot criado.');
  return { botId: body.id };
}

// Best-effort: cancelar um bot que ainda não entrou na chamada (reunião
// cancelada antes do horário). Se o bot já estiver gravando/terminado, a
// Recall.ai recusa — o catch no chamador ignora esse caso.
export async function cancelRecallBot(botId: string): Promise<void> {
  const apiKey = await loadRecallApiKey();
  if (!apiKey) return;
  try {
    await fetch(`${RECALL_API_BASE}/bot/${encodeURIComponent(botId)}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${apiKey}` },
    });
  } catch {
    // Best-effort — ver comentário acima.
  }
}

export interface RecallTranscriptTurn {
  speaker: string | null;
  text: string;
}

// Fallback para quando o webhook não traz a transcrição inline (só o aviso de
// que ficou pronta) — busca pelo endpoint dedicado.
export async function fetchRecallTranscript(botId: string): Promise<RecallTranscriptTurn[] | null> {
  const apiKey = await loadRecallApiKey();
  if (!apiKey) return null;
  const res = await fetch(`${RECALL_API_BASE}/bot/${encodeURIComponent(botId)}/transcript/`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return null;
  return body
    .map((entry) => {
      const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const words = Array.isArray(obj.words) ? obj.words : [];
      const text = words
        .map((w) => (w && typeof w === 'object' ? String((w as Record<string, unknown>).text ?? '') : ''))
        .join(' ')
        .trim();
      const speakerRaw = obj.speaker;
      const speaker = typeof speakerRaw === 'string' ? speakerRaw : null;
      return { speaker, text };
    })
    .filter((turn) => turn.text.length > 0);
}

export function formatTranscript(turns: RecallTranscriptTurn[]): string {
  return turns.map((turn) => `${turn.speaker ?? 'Participante'}: ${turn.text}`).join('\n');
}

export interface RecallBotStatus {
  statusCode: string | null;
  recordingUrl: string | null;
}

// GET /bot/{id}/ pra pegar o status atual e a URL da gravação — usado pelo
// webhook, que só confirma QUE algo mudou, não os detalhes.
export async function fetchRecallBotStatus(botId: string): Promise<RecallBotStatus | null> {
  const apiKey = await loadRecallApiKey();
  if (!apiKey) return null;
  const res = await fetch(`${RECALL_API_BASE}/bot/${encodeURIComponent(botId)}/`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return null;

  const statusChanges = Array.isArray(body.status_changes) ? body.status_changes : [];
  const lastChange = statusChanges[statusChanges.length - 1];
  const statusCode =
    (lastChange && typeof lastChange === 'object' ? (lastChange as Record<string, unknown>).code : null) ??
    (typeof body.status === 'string' ? body.status : null);

  // Vários formatos documentados pela Recall.ai ao longo das versões da API
  // (recordings[].media_shortcuts.video_mixed.data.download_url é o mais
  // recente) — tenta em ordem, sem quebrar se algum nível não existir.
  const recordings = Array.isArray(body.recordings) ? body.recordings : [];
  const firstRecording = recordings[0] && typeof recordings[0] === 'object' ? (recordings[0] as Record<string, unknown>) : {};
  const shortcuts = firstRecording.media_shortcuts && typeof firstRecording.media_shortcuts === 'object'
    ? (firstRecording.media_shortcuts as Record<string, unknown>)
    : {};
  const videoMixed = shortcuts.video_mixed && typeof shortcuts.video_mixed === 'object'
    ? (shortcuts.video_mixed as Record<string, unknown>)
    : {};
  const videoData = videoMixed.data && typeof videoMixed.data === 'object'
    ? (videoMixed.data as Record<string, unknown>)
    : {};
  const recordingUrl =
    (typeof videoData.download_url === 'string' ? videoData.download_url : null) ??
    (typeof body.video_url === 'string' ? body.video_url : null);

  return {
    statusCode: typeof statusCode === 'string' ? statusCode : null,
    recordingUrl,
  };
}
