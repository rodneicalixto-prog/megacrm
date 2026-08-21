import { describe, expect, it } from 'vitest';
import { readEvolutionQr } from '../../src/lib/evolutionQr';

describe('readEvolutionQr', () => {
  it('reads the nested data URL returned while creating an instance', () => {
    expect(readEvolutionQr({ qrcode: { base64: 'data:image/png;base64,abc' } })).toEqual({
      image: 'data:image/png;base64,abc',
      pairingCode: null,
    });
  });

  it('normalizes raw base64 returned by the connect endpoint', () => {
    expect(readEvolutionQr({ base64: 'iVBORw0KGgoAAA' }).image).toBe(
      'data:image/png;base64,iVBORw0KGgoAAA',
    );
  });

  it('supports pairing codes when the server does not return an image', () => {
    expect(readEvolutionQr({ pairingCode: 'ABCD-1234' })).toEqual({
      image: null,
      pairingCode: 'ABCD-1234',
    });
  });

  it('returns an empty result for invalid responses', () => {
    expect(readEvolutionQr(null)).toEqual({ image: null, pairingCode: null });
  });
});
