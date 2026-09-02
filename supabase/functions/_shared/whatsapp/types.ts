// ============================================================================
// Camada agnóstica de provedor de WhatsApp (Fase 3)
// ----------------------------------------------------------------------------
// O core de reconciliação (Fase 4) consome SÓ esta interface — nunca conhece o
// formato bruto de cada provedor. Adicionar/trocar provedor = escrever um
// adapter novo, sem tocar no core.
//
// parseInboundWebhook / extractReferral são PUROS (sem I/O, sem Deno API) para
// serem testáveis em Node e reutilizáveis em qualquer runtime.
// ============================================================================

export type ProviderName = 'zernio' | 'evolution';

// Contrato único de mensagem inbound, normalizado a partir do payload bruto de
// cada provedor (Zernio Cloud-API-shape vs Evolution Baileys-shape).
export interface NormalizedInbound {
  from: string;          // identidade do remetente (E.164 quando WhatsApp)
  text: string | null;   // corpo textual (null p/ mídia sem legenda)
  messageId: string;     // id estável da mensagem (idempotência)
  timestamp: string | null; // ISO-8601 quando disponível
  isFromMe: boolean;     // true = mensagem enviada pela própria conta (echo)
  raw: unknown;          // payload cru, para auditoria/reprocesso
  // Extras opcionais (úteis à ingestão; fora do contrato mínimo da spec):
  contentType?: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string | null;
  conversationId?: string | null;
  senderName?: string | null;
}

// Objeto referral do Click-to-WhatsApp (CTWA). Só o caminho oficial (Zernio
// sobre Cloud API) consegue entregá-lo; provedores não-oficiais retornam null.
export interface Referral {
  ctwa_clid: string;
  source_id: string | null;
  headline: string | null;
}

export interface SendOptions {
  conversationId?: string;   // Zernio envia 1:1 por conversationId
  mediaUrl?: string | null;
  mediaType?: string;        // image | video | audio | document
  quotedMessageId?: string;
  quotedRemoteJid?: string;
  quotedFromMe?: boolean;
  voiceNote?: boolean;
}

export interface SendResult {
  ok: boolean;
  messageId: string | null;
  raw: unknown;
  error?: string;
}

export interface DownloadedInboundMedia {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
}

// Reação (emoji) recebida via webhook — distinta de uma mensagem normal:
// não cria contato/conversa/mensagem nova, só anota a mensagem alvo.
export interface ParsedReaction {
  /** id (provider-side) da mensagem original que recebeu a reação. */
  targetMessageId: string;
  /** '' = reação removida (Baileys manda texto vazio nesse caso). */
  emoji: string;
  /** true = reagiu pelo próprio número conectado (o dono, fora do CRM). */
  fromMe: boolean;
}

export interface WhatsAppProvider {
  readonly name: ProviderName;
  sendMessage(to: string, text: string, opts?: SendOptions): Promise<SendResult>;
  parseInboundWebhook(rawPayload: unknown): NormalizedInbound | null;
  extractReferral(rawPayload: unknown): Referral | null;
  downloadInboundMedia?(rawPayload: unknown): Promise<DownloadedInboundMedia | null>;
  /** Só a rota Evolution (Baileys) entrega reactionMessage; Zernio não implementa. */
  parseReaction?(rawPayload: unknown): ParsedReaction | null;
}

// ---- helpers de leitura tolerante (compartilhados pelos adapters) ----------

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function str(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.startsWith('+') ? t : `+${t}`;
}

// Converte epoch (s ou ms) ou string ISO em ISO-8601; null se indeterminado.
export function toIso(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'number' && isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value; // epoch s → ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// ---- helpers do shape Baileys (rota não-oficial) ---------------------------

// remoteJid: "5511999998888@s.whatsapp.net" (1:1) ou "...@g.us" (grupo).
export function jidToPhone(jid: string | null): string | null {
  if (!jid) return null;
  const bare = jid.split(/[:@]/)[0];
  if (!/^\d{6,}$/.test(bare)) return null;
  return normalizePhone(bare);
}

// Mensagem "visualização única" / efêmera / documento-com-legenda embrulha a
// mensagem real num envelope (`{ message: {...} }`) em vez de trazê-la nas
// chaves de sempre — sem desembrulhar, caía direto no fallback genérico e
// virava bolha em branco (content null). Recursivo: um envelope pode embrulhar
// outro (ex.: efêmera + visualização única juntas).
const ENVELOPE_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

export function decodeBaileysContent(msg: Record<string, unknown>): {
  contentType: NormalizedInbound['contentType'];
  content: string | null;
  mediaUrl: string | null;
} {
  for (const key of ENVELOPE_KEYS) {
    const inner = asObject(asObject(msg[key]).message);
    if (Object.keys(inner).length) {
      return decodeBaileysContent(inner);
    }
  }
  if (typeof msg.conversation === 'string') {
    return { contentType: 'text', content: msg.conversation, mediaUrl: null };
  }
  const ext = asObject(msg.extendedTextMessage);
  if (typeof ext.text === 'string') {
    // Link com preview (Facebook, Instagram, YouTube...) chega como texto,
    // mas o Baileys embute uma miniatura (jpegThumbnail) junto — é a "foto"
    // que o WhatsApp mostra ao lado do link. Sem isso a mensagem vira só a
    // URL crua. downloadInboundMedia (Evolution) decodifica esse base64
    // direto do payload, sem precisar pedir mídia pra API.
    if (typeof ext.jpegThumbnail === 'string' && ext.jpegThumbnail.length > 0) {
      return { contentType: 'image', content: ext.text, mediaUrl: null };
    }
    return { contentType: 'text', content: ext.text, mediaUrl: null };
  }
  // Evolution com S3/MinIO anexa mediaUrl irmão dos *Message; preferimos ele.
  const stored = str(msg, ['mediaUrl']);
  const image = asObject(msg.imageMessage);
  if (Object.keys(image).length) {
    return { contentType: 'image', content: str(image, ['caption']), mediaUrl: stored ?? str(image, ['url', 'directPath']) };
  }
  const video = asObject(msg.videoMessage);
  if (Object.keys(video).length) {
    return { contentType: 'video', content: str(video, ['caption']), mediaUrl: stored ?? str(video, ['url', 'directPath']) };
  }
  const audio = asObject(msg.audioMessage);
  if (Object.keys(audio).length) {
    return { contentType: 'audio', content: null, mediaUrl: stored ?? str(audio, ['url', 'directPath']) };
  }
  const doc = asObject(msg.documentMessage);
  if (Object.keys(doc).length) {
    return { contentType: 'document', content: str(doc, ['caption', 'fileName']), mediaUrl: stored ?? str(doc, ['url', 'directPath']) };
  }
  const sticker = asObject(msg.stickerMessage);
  if (Object.keys(sticker).length) {
    return { contentType: 'image', content: null, mediaUrl: stored ?? str(sticker, ['url', 'directPath']) };
  }
  const location = asObject(msg.locationMessage ?? msg.liveLocationMessage);
  if (Object.keys(location).length) {
    const lat = location.degreesLatitude;
    const lng = location.degreesLongitude;
    const link = typeof lat === 'number' && typeof lng === 'number' ? `https://maps.google.com/?q=${lat},${lng}` : null;
    return { contentType: 'text', content: link ? `📍 Localização: ${link}` : '📍 Localização compartilhada', mediaUrl: null };
  }
  const contactCard = asObject(msg.contactMessage);
  if (Object.keys(contactCard).length) {
    return { contentType: 'text', content: `👤 Contato compartilhado: ${str(contactCard, ['displayName']) ?? 'sem nome'}`, mediaUrl: null };
  }
  // Templates/interativos enviados pelo WhatsApp ou por uma automacao chegam
  // na Evolution como `templateMessage`. O texto pode variar de lugar entre
  // versoes do Baileys, principalmente `hydratedTemplate` e
  // `hydratedFourRowTemplate`. Antes este shape caia no fallback e aparecia na
  // Inbox como "[Mensagem não suportada: templateMessage]", embora o conteúdo
  // textual estivesse presente no payload.
  const template = asObject(msg.templateMessage);
  if (Object.keys(template).length) {
    const hydrated = asObject(template.hydratedTemplate);
    const fourRows = asObject(template.hydratedFourRowTemplate);
    const body =
      str(template, ['hydratedContentText', 'contentText', 'text']) ??
      str(hydrated, ['hydratedContentText', 'contentText', 'text']) ??
      str(fourRows, ['hydratedContentText', 'contentText', 'text']);
    const footer =
      str(template, ['hydratedFooterText', 'footerText']) ??
      str(hydrated, ['hydratedFooterText', 'footerText']) ??
      str(fourRows, ['hydratedFooterText', 'footerText']);
    const content = [body, footer].filter((value): value is string => Boolean(value)).join('\n');
    return {
      contentType: 'text',
      content: content || 'Mensagem interativa do WhatsApp',
      mediaUrl: null,
    };
  }
  const buttons = asObject(msg.buttonsMessage);
  if (Object.keys(buttons).length) {
    return {
      contentType: 'text',
      content: str(buttons, ['contentText', 'text', 'footerText']) ?? 'Mensagem com botões',
      mediaUrl: null,
    };
  }
  const buttonResponse = asObject(msg.buttonsResponseMessage);
  if (Object.keys(buttonResponse).length) {
    return {
      contentType: 'text',
      content: str(buttonResponse, ['selectedDisplayText', 'selectedButtonId']) ?? 'Resposta de botão',
      mediaUrl: null,
    };
  }
  const listResponse = asObject(msg.listResponseMessage);
  if (Object.keys(listResponse).length) {
    const reply = asObject(listResponse.singleSelectReply);
    return {
      contentType: 'text',
      content: str(listResponse, ['title', 'description']) ?? str(reply, ['selectedRowId']) ?? 'Resposta de lista',
      mediaUrl: null,
    };
  }
  // Tipo não mapeado (enquete, resposta de botão/lista, cartão de visita
  // múltiplo, etc.) — melhor um rótulo genérico com a chave real (ajuda a
  // identificar o tipo quando aparecer em produção) do que uma bolha em
  // branco sem nenhuma pista.
  const unknownKey = Object.keys(msg)[0];
  return {
    contentType: 'text',
    content: unknownKey ? `[Mensagem não suportada: ${unknownKey}]` : '[Mensagem não suportada]',
    mediaUrl: null,
  };
}
