// EvolutionProvider — Evolution API v2 (self-hosted, Baileys por baixo).
//
// Endpoints (docs oficiais v2):
//   POST {server}/message/sendText/{instance}   { number, text }
//   POST {server}/message/sendMedia/{instance}  { number, mediatype, media, caption }
//   Header de auth: `apikey: <API_KEY>`.
//
// Webhook (evento messages.upsert):
//   { event, instance, data: { key:{remoteJid,fromMe,id,participant?}, pushName,
//     message:{...Baileys...}, messageType, messageTimestamp } }
// Com S3/MinIO configurado, `data.message.mediaUrl` traz a URL já armazenada.
//
// NÃO entrega referral/ctwa_clid — como todo provedor não-oficial, a atribuição
// CTWA depende do código de rastreio no texto (tratado no core).

import {
  asObject,
  decodeBaileysContent,
  jidToPhone,
  str,
  toIso,
  type NormalizedInbound,
  type Referral,
  type SendOptions,
  type SendResult,
  type WhatsAppProvider,
} from './types.ts';

// mediatype aceito pelo /message/sendMedia. `audio` tem rota própria
// (/sendWhatsAppAudio) e não é um mediatype válido aqui.
function toMediaType(raw: string | undefined): 'image' | 'video' | 'document' {
  if (raw === 'image' || raw === 'video') return raw;
  return 'document';
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly name = 'evolution' as const;
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly instance: string;

  constructor(serverUrl: string, apiKey: string, instance: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.instance = instance;
  }

  parseInboundWebhook(rawPayload: unknown): NormalizedInbound | null {
    const root = asObject(rawPayload);

    // Só mensagens recebidas interessam. Os demais eventos (connection.update,
    // presence.update, contacts.upsert, ...) são aceitos e ignorados.
    const evt = (str(root, ['event']) ?? '').toLowerCase().replace(/_/g, '.');
    if (evt && evt !== 'messages.upsert') return null;

    // `data` pode vir como objeto ou como array (upsert em lote) — nesse caso
    // processamos a primeira mensagem; o resto chega em webhooks próprios.
    const data = Array.isArray(root.data)
      ? asObject(root.data[0])
      : Object.keys(asObject(root.data)).length
        ? asObject(root.data)
        : root; // webhook_by_events entrega o corpo já desembrulhado

    const key = asObject(data.key);
    const messageId = str(key, ['id']);
    if (!messageId) return null;

    const remoteJid = str(key, ['remoteJid']);

    // Grupos e status/broadcast NAO entram. Numa conversa de grupo o remetente
    // e o `participant`, entao tratar isso como inbound faria o CRM abrir uma
    // conversa 1:1 com quem falou no grupo — e o agente responderia no PRIVADO
    // de alguem que nunca chamou a empresa. O numero conectado costuma ser um
    // WhatsApp real, com grupos; isso vaza atendimento automatico para eles.
    if ((remoteJid ?? '').endsWith('@g.us')) return null;
    if ((remoteJid ?? '').endsWith('@broadcast')) return null;

    const from = jidToPhone(remoteJid);
    if (!from) return null;

    const { contentType, content, mediaUrl } = decodeBaileysContent(asObject(data.message));

    return {
      from,
      text: content,
      messageId,
      timestamp: toIso(data.messageTimestamp),
      // Tolerante de proposito: errar aqui faz o agente responder por cima do
      // dono. Se `fromMe` vier como string ou 1, ainda conta como echo.
      isFromMe: key.fromMe === true || key.fromMe === 'true' || key.fromMe === 1,
      raw: rawPayload,
      contentType,
      mediaUrl,
      conversationId: remoteJid,
      senderName: str(data, ['pushName']),
    };
  }

  // Baileys nunca carrega o ctwa_clid do Meta.
  extractReferral(_rawPayload: unknown): Referral | null {
    return null;
  }

  async sendMessage(to: string, text: string, opts: SendOptions = {}): Promise<SendResult> {
    const number = to.replace(/\D/g, '');
    try {
      // Áudio tem rota dedicada; imagem/vídeo/documento vão por /sendMedia.
      const isAudio = opts.mediaUrl != null && opts.mediaType === 'audio';
      const path = opts.mediaUrl
        ? isAudio
          ? `/message/sendWhatsAppAudio/${this.instance}`
          : `/message/sendMedia/${this.instance}`
        : `/message/sendText/${this.instance}`;

      const body = !opts.mediaUrl
        ? { number, text }
        : isAudio
          ? { number, audio: opts.mediaUrl }
          : {
              number,
              mediatype: toMediaType(opts.mediaType),
              media: opts.mediaUrl,
              caption: text || undefined,
            };

      const res = await fetch(`${this.serverUrl}${path}`, {
        method: 'POST',
        headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      const messageId = str(asObject(asObject(raw).key), ['id']) ?? str(asObject(raw), ['id']);
      return { ok: res.ok, messageId, raw, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, messageId: null, raw: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
