import { describe, expect, it } from 'vitest';
import { isEvolutionConnected, readEvolutionConnectionState } from '../../src/lib/evolutionState';

describe('Evolution connection state', () => {
  it.each([
    [{ instance: { state: 'open' } }, 'open'],
    [{ connectionStatus: 'connected' }, 'connected'],
    [{ instance: { status: 'online' } }, 'online'],
    [{ state: 'close' }, 'close'],
  ])('lê os formatos usados pelas versões e forks da v2', (body, expected) => {
    expect(readEvolutionConnectionState(body)).toBe(expected);
  });

  it('não inventa estado quando a resposta muda de formato', () => {
    expect(readEvolutionConnectionState({ instance: { name: 'linha-1' } })).toBeNull();
    expect(readEvolutionConnectionState(null)).toBeNull();
  });

  it.each(['open', 'connected', 'online'])('reconhece %s como conectado', (state) => {
    expect(isEvolutionConnected(state)).toBe(true);
  });

  it('mantém estados fechados e desconhecidos como offline', () => {
    expect(isEvolutionConnected('close')).toBe(false);
    expect(isEvolutionConnected(null)).toBe(false);
  });
});
