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
