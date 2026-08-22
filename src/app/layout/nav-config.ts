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
  Send,
  MessageCircle,
  Video,
} from 'lucide-react';
import type { CommercialModule } from '@/lib/plan';

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
  // Itens ligados a um módulo do pacote comercial (Campanhas / Vendas &
  // Recompra / Agente de IA): só aparecem se a instalação tiver contratado
  // esse módulo (ver useEnabledModules / get-instance-plan). Independente de
  // adminOnly — os dois filtros se combinam.
  module?: CommercialModule;
}

// Single source of truth for both the Sidebar and the router. Adding a new
// app section is a one-liner here.
// Base de Conhecimento, Follow-ups e Horário de atendimento viraram abas dentro
// de /ai-agent. Credenciais virou aba dentro de Configurações. Templates virou
// aba dentro de /campaigns (Módulo 1).
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/team-chat', label: 'Chat interno', icon: MessageCircle },
  { to: '/funil', label: 'Funil', icon: SquareKanban },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/meetings', label: 'Reuniões', icon: Video },
  { to: '/contacts', label: 'Contatos', icon: Users },
  { to: '/campaigns', label: 'Campanhas', icon: Megaphone, module: 'campaigns' },
  { to: '/disparo-massa', label: 'Disparo em massa', icon: Send, module: 'disparo_massa' },
  { to: '/vendas', label: 'Vendas & Recompra', icon: BarChart3, module: 'vendas' },
  { to: '/ai-agent', label: 'Agente de IA', icon: Bot, adminOnly: true, module: 'ai_agent' },
  { to: '/settings/profile', label: 'Configurações', icon: Settings },
];
