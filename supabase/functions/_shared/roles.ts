export type CallerRole = 'super_admin' | 'admin' | 'supervisor' | 'operator';

// Administram a instala??o. super_admin ? o topo; admin tem o mesmo alcance
// operacional, exceto no departamento restrito.
export const ADMIN_ROLES: CallerRole[] = ['super_admin', 'admin'];

// Todos os pap?is humanos podem responder, respeitando o recorte de conversa.
export const OPERATING_ROLES: CallerRole[] = [
  'super_admin',
  'admin',
  'supervisor',
  'operator',
];

export function canOperate(role: CallerRole | null): boolean {
  return role !== null && OPERATING_ROLES.includes(role);
}
