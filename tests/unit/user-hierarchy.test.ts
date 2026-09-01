import { describe, expect, it } from 'vitest';
import { canManageUser } from '../../supabase/functions/_shared/user-hierarchy';

describe('canManageUser', () => {
  it('permite super admin administrar todos os níveis inferiores', () => {
    expect(canManageUser('super_admin', 'admin')).toBe(true);
    expect(canManageUser('super_admin', 'supervisor')).toBe(true);
    expect(canManageUser('super_admin', 'operator')).toBe(true);
  });

  it('permite admin administrar somente supervisor e operador', () => {
    expect(canManageUser('admin', 'supervisor')).toBe(true);
    expect(canManageUser('admin', 'operator')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('admin', 'super_admin')).toBe(false);
  });

  it('nunca permite alterar usuário do mesmo nível ou superior', () => {
    expect(canManageUser('super_admin', 'super_admin')).toBe(false);
    expect(canManageUser('supervisor', 'operator')).toBe(false);
    expect(canManageUser('operator', 'operator')).toBe(false);
  });
});
