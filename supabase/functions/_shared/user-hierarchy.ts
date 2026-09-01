import type { CallerRole } from './roles.ts';

// Só permite administrar níveis estritamente inferiores. Isso impede que um
// admin suspenda outro admin ou o owner, e impede qualquer suspensão entre
// super_admins.
const ROLE_LEVEL: Record<CallerRole, number> = {
  operator: 1,
  supervisor: 2,
  admin: 3,
  super_admin: 4,
};

export function canManageUser(caller: CallerRole, target: CallerRole): boolean {
  return (caller === 'admin' || caller === 'super_admin')
    && ROLE_LEVEL[caller] > ROLE_LEVEL[target];
}
