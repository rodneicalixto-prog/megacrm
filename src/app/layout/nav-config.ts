import {
  LayoutDashboard,
  Inbox,
  Megaphone,
  Users,
  Bot,
  Settings,
  BarChart3,
  type LucideIcon,
  SquareKanban,
  CalendarDays,
} from 'lucide-react';

// Quem enxerga item marcado adminOnly. Uma função em vez da comparação solta
// que estava repetida em três telas: quando super_admin entrou no enum, duas
// delas continuaram comparando com 'admin' e o dono da instalação passou a ver
// menos que um gerente.
export function canSeeAdminNav(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // Itens adminOnly só aparecem para role 'admin'. Operadores não veem
  // Credenciais (escrita admin-only — antes a rota existia mas sem link,
  // deixando Configurações/Equipe/Conta inalcançáveis pela UI).
  adminOnly?: boolean;
}

// Single source of truth for both the Sidebar and the router. Adding a new
// app section is a one-liner here.
// Base de Conhecimento, Follow-ups e Horário de atendimento viraram abas dentro
// de /ai-agent. Credenciais virou aba dentro de Configurações. Templates virou
// aba dentro de /campaigns (Módulo 1).
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/funil', label: 'Funil', icon: SquareKanban },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/contacts', label: 'Contatos', icon: Users },
  { to: '/campaigns', label: 'Campanhas', icon: Megaphone },
  { to: '/vendas', label: 'Vendas & Recompra', icon: BarChart3 },
  { to: '/ai-agent', label: 'Agente de IA', icon: Bot, adminOnly: true },
  { to: '/settings/profile', label: 'Configurações', icon: Settings },
];
