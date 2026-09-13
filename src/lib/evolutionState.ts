export function readEvolutionConnectionState(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const nested = root.instance && typeof root.instance === 'object'
    ? root.instance as Record<string, unknown>
    : {};
  for (const key of ['state', 'connectionStatus', 'status']) {
    const value = nested[key] ?? root[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

export function isEvolutionConnected(state: string | null): boolean {
  return state === 'open' || state === 'connected' || state === 'online';
}

export interface EvolutionOwnerInfo {
  phoneNumber: string | null;
  profileName: string | null;
}

// Shape do /instance/fetchInstances varia entre versões da Evolution API
// (ASSUMIDO — não há doc formal fixa): às vezes um objeto único, às vezes um
// array, com os campos de dono ora na raiz ora dentro de "instance". Aqui
// aceitamos qualquer uma dessas formas em vez de travar em uma só.
export function readEvolutionOwnerInfo(body: unknown): EvolutionOwnerInfo {
  const empty: EvolutionOwnerInfo = { phoneNumber: null, profileName: null };
  if (!body) return empty;
  const entry = Array.isArray(body) ? body[0] : body;
  if (!entry || typeof entry !== 'object') return empty;
  const root = entry as Record<string, unknown>;
  const nested = root.instance && typeof root.instance === 'object'
    ? (root.instance as Record<string, unknown>)
    : {};

  const jid = [nested.ownerJid, root.ownerJid, nested.owner, root.owner]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const rawNumber = [nested.number, root.number]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const digitsFromJid = jid ? jid.replace(/@.*$/, '').replace(/\D/g, '') : '';
  const phoneNumber = (rawNumber?.replace(/\D/g, '') || digitsFromJid) || null;

  const profileName = [nested.profileName, root.profileName]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined ?? null;

  return { phoneNumber, profileName };
}
