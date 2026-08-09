// Verificacao de assinatura HMAC-SHA256 dos webhooks.
//
// Estava duplicada entre zernio-webhook e whatsapp-inbound. Duas copias de um
// gate de seguranca e uma copia a mais do que se consegue manter certa: se uma
// ganhar uma correcao, a outra vira o buraco.
//
// O formato do header (hex vs base64) nao esta explicito na doc do Zernio, e o
// prefixo "sha256=" e opcional — aceitamos as quatro combinacoes. Comparacao em
// tempo constante para nao vazar o quanto do prefixo bateu.

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

export function macToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function macToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function signatureMatches(header: string, mac: Uint8Array): boolean {
  const got = (header.startsWith('sha256=') ? header.slice(7) : header).trim();
  return timingSafeEqualStr(got, macToHex(mac)) || timingSafeEqualStr(got, macToBase64(mac));
}

// Gate completo: assina o corpo cru e compara com o header recebido.
// Header ausente ou segredo ausente => NAO passa. Falhar fechado e o unico
// comportamento aceitavel num verificador de webhook.
export async function verifyWebhookSignature(
  secret: string | null | undefined,
  rawBody: string,
  header: string | null | undefined,
): Promise<boolean> {
  if (!secret || !header) return false;
  return signatureMatches(header, await hmacSha256(secret, rawBody));
}
