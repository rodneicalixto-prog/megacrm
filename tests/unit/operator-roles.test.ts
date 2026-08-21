import { describe, expect, test } from 'vitest';
import { canOperate } from '../../supabase/functions/_shared/roles.ts';

describe('pap?is que podem responder no Inbox', () => {
  test.each(['super_admin', 'admin', 'supervisor', 'operator'] as const)(
    '%s pode operar uma conversa',
    (role) => expect(canOperate(role)).toBe(true),
  );

  test('papel ausente n?o pode operar', () => {
    expect(canOperate(null)).toBe(false);
  });
});
