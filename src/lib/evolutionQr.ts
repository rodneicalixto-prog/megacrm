type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface EvolutionQr {
  image: string | null;
  pairingCode: string | null;
}

export function readEvolutionQr(value: unknown): EvolutionQr {
  const root = record(value);
  const qrcode = record(root.qrcode ?? root.qr);
  const rawImage = text(qrcode.base64) ?? text(root.base64);
  const image = rawImage
    ? rawImage.startsWith('data:image/') ? rawImage : `data:image/png;base64,${rawImage}`
    : null;

  return {
    image,
    pairingCode: text(qrcode.pairingCode) ?? text(root.pairingCode),
  };
}
