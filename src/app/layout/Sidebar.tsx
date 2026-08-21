import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, canSeeAdminNav } from './nav-config';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { useBranding } from '@/hooks/useBranding';
import { useEnabledModules } from '@/hooks/useEnabledModules';

const STORAGE_KEY = 'mch:sidebar-collapsed';

// Lê o estado persistido de forma preguiçosa (useState initializer) pra não
// piscar expandido→colapsado no primeiro paint quando o usuário já tinha
// recolhido antes.
function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Sidebar() {
  const { branding } = useBranding();
  const { role } = useAppUser();
  const { hasModule } = useEnabledModules();
  const items = NAV_ITEMS.filter(
    (item) => (!item.adminOnly || canSeeAdminNav(role)) && (!item.module || hasModule(item.module)),
  );
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Sem localStorage (modo privado etc.) — o estado só não sobrevive ao reload.
    }
  }, [collapsed]);

  return (
    <aside
      className={cn(
        'hidden md:flex md:flex-col shrink-0 glass-surface border-r border-[rgba(59,130,246,0.1)] relative',
        'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-60',
      )}
      aria-label="Navegação principal"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        aria-expanded={!collapsed}
        className={cn(
          'absolute top-1/2 -right-3 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center',
          'rounded-full border border-[rgba(59,130,246,0.25)] bg-[var(--color-bg-primary,#0A0A0F)]',
          'text-[var(--color-text-secondary)] shadow-[0_0_12px_rgba(59,130,246,0.15)] transition-colors',
          'hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]',
        )}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div
        className={cn(
          'h-16 flex items-center gap-3 border-b border-[rgba(59,130,246,0.08)]',
          collapsed ? 'justify-center px-2' : 'px-5',
        )}
      >
        <img
          src={branding.logoUrl ?? '/agentise-mark.png'}
          alt={branding.companyName ?? 'Agentise'}
          className="h-9 w-9 shrink-0 rounded-lg object-contain shadow-[0_0_20px_rgba(59,130,246,0.35)]"
        />
        {!collapsed && (
          <div className="leading-tight min-w-0">
            <div className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] truncate">
              {branding.companyName ?? 'Agentise'}
            </div>
            <div className="text-sm font-bold text-[var(--color-text-primary)]">
              MEGACRM
            </div>
          </div>
        )}
      </div>

      <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                  collapsed && 'justify-center px-0',
                  'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5',
                  isActive &&
                    'bg-gradient-to-r from-[rgba(59,130,246,0.18)] to-[rgba(59,130,246,0.04)] text-[var(--color-text-primary)] shadow-[inset_0_1px_0_rgba(59,130,246,0.15)]',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div
        className={cn(
          'py-4 border-t border-[rgba(59,130,246,0.08)] text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] opacity-70',
          collapsed ? 'px-2 text-center' : 'px-4',
        )}
      >
        {collapsed ? 'v0.1' : 'v0.1 · dev'}
      </div>
    </aside>
  );
}
