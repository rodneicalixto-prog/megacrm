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
  type DownloadedInboundMedia,
  type ParsedReaction,
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

  // Reação (👍 etc.) chega como messages.upsert também, mas com um
  // `reactionMessage` no lugar do conteúdo normal — `key.id` desse envelope é
  // o id da própria reação, não da mensagem reagida; o alvo mora em
  // `reactionMessage.key.id`. Sem isso o whatsapp-inbound trataria o evento
  // como mensagem de texto vazia e criaria uma bolha em branco na conversa.
  parseReaction(rawPayload: unknown): ParsedReaction | null {
    const root = asObject(rawPayload);
    const evt = (str(root, ['event']) ?? '').toLowerCase().replace(/_/g, '.');
    if (evt && evt !== 'messages.upsert') return null;

    const data = Array.isArray(root.data)
      ? asObject(root.data[0])
      : Object.keys(asObject(root.data)).length
        ? asObject(root.data)
        : root;

    const reactionMessage = asObject(asObject(data.message).reactionMessage);
    if (!Object.keys(reactionMessage).length) return null;

    const targetKey = asObject(reactionMessage.key);
    const targetMessageId = str(targetKey, ['id']);
    if (!targetMessageId) return null;

    const outerKey = asObject(data.key);
    return {
      targetMessageId,
      emoji: str(reactionMessage, ['text']) ?? '',
      fromMe: outerKey.fromMe === true || outerKey.fromMe === 'true' || outerKey.fromMe === 1,
    };
  }

  async downloadInboundMedia(rawPayload: unknown): Promise<DownloadedInboundMedia | null> {
    const root = asObject(rawPayload);
    const data = Array.isArray(root.data)
      ? asObject(root.data[0])
      : Object.keys(asObject(root.data)).length
        ? asObject(root.data)
        : root;
    const message = asObject(data.message);
    const key = asObject(data.key);
    if (!Object.keys(message).length && !str(key, ['id'])) return null;

    // Miniatura de link (extendedTextMessage.jpegThumbnail) já vem embutida
    // em base64 no próprio payload — não é mídia "de verdade" pra Evolution
    // buscar, então decodifica direto em vez de chamar a API.
    const linkThumbnail = str(asObject(message.extendedTextMessage), ['jpegThumbnail']);
    if (linkThumbnail) {
      const binary = atob(linkThumbnail.replace(/^data:[^;]+;base64,/, ''));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return { bytes, mime: 'image/jpeg', fileName: 'link-preview.jpg' };
    }

    const res = await fetch(this.serverUrl + '/chat/getBase64FromMediaMessage/' + this.instance, {
      method: 'POST',
      headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: data }),
    });
    if (!res.ok) throw new Error('Evolution media HTTP ' + res.status);

    const body = asObject(await res.json().catch(() => ({})));
    const base64 = str(body, ['base64']);
    if (!base64) throw new Error('Evolution não devolveu a mídia em base64');
    const binary = atob(base64.replace(/^data:[^;]+;base64,/, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const mime = str(body, ['mimetype']) ?? 'application/octet-stream';
    const extension = mime.split('/')[1]?.split(';')[0] || 'bin';
    const fileName = str(body, ['fileName']) ?? ('media.' + extension);
    return { bytes, mime, fileName };
  }
  async sendPresence(to: string, presence: 'composing' | 'paused'): Promise<void> {
    const number = to.replace(/\D/g, '');
    const res = await fetch(`${this.serverUrl}/chat/sendPresence/${this.instance}`, {
      method: 'POST',
      headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, presence, delay: 1200 }),
    });
    if (!res.ok) throw new Error(`Evolution presence HTTP ${res.status}`);
  }

  async react(to: string, messageId: string, emoji: string, fromMe: boolean): Promise<void> {
    const number = to.replace(/\D/g, '');
    const res = await fetch(`${this.serverUrl}/message/sendReaction/${this.instance}`, {
      method: 'POST',
      headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: { remoteJid: `${number}@s.whatsapp.net`, fromMe, id: messageId },
        reaction: emoji,
      }),
    });
    if (!res.ok) throw new Error(`Evolution reaction HTTP ${res.status}`);
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
        ? {
            number,
            text,
            quoted: opts.quotedMessageId
              ? { key: { remoteJid: opts.quotedRemoteJid, fromMe: opts.quotedFromMe ?? false, id: opts.quotedMessageId } }
              : undefined,
          }
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
      if (!res.ok && isAudio && !opts.voiceNote) {
        const fallback = await fetch(`${this.serverUrl}/message/sendMedia/${this.instance}`, {
          method: 'POST',
          headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number,
            mediatype: 'audio',
            media: opts.mediaUrl,
            caption: text || undefined,
          }),
        });
        const fallbackRaw = await fallback.json().catch(() => ({}));
        const fallbackMessageId =
          str(asObject(asObject(fallbackRaw).key), ['id']) ?? str(asObject(fallbackRaw), ['id']);
        return {
          ok: fallback.ok,
          messageId: fallbackMessageId,
          raw: fallbackRaw,
          error: fallback.ok ? undefined : `HTTP ${fallback.status}`,
        };
      }
      const raw = await res.json().catch(() => ({}));
      const messageId = str(asObject(asObject(raw).key), ['id']) ?? str(asObject(raw), ['id']);
      return { ok: res.ok, messageId, raw, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, messageId: null, raw: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
