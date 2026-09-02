import { useSearchParams, Navigate } from 'react-router-dom';
import { FolderOpen, Loader2, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEnabledModules } from '@/hooks/useEnabledModules';
import { DispatchList } from '@/components/mass-dispatch/DispatchList';
import { DispatchFilesTab } from '@/components/mass-dispatch/DispatchFilesTab';

type TabId = 'disparos' | 'arquivos';

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  render: () => React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'disparos', label: 'Disparos', icon: Send, render: () => <DispatchList /> },
  { id: 'arquivos', label: 'Arquivos', icon: FolderOpen, render: () => <DispatchFilesTab /> },
];

function isTabId(v: string | null): v is TabId {
  return v === 'disparos' || v === 'arquivos';
}

export default function MassDispatchPage() {
  const [params, setParams] = useSearchParams();
  const { loading: loadingModules, hasModule } = useEnabledModules();
  const raw = params.get('tab');
  const active: TabId = isTabId(raw) ? raw : 'disparos';
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  if (loadingModules) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }
  if (!hasModule('disparo_massa')) return <Navigate to="/dashboard" replace />;

  const selectTab = (id: TabId) => {
    setParams(id === 'disparos' ? {} : { tab: id }, { replace: true });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl icon-chip flex items-center justify-center">
          <Send className="h-5 w-5 text-[var(--accent-primary)]" />
        </div>
        <div>
          <div className="text-label">Seção</div>
          <h1 className="text-2xl font-bold text-display">Disparo em massa</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Mensagens de texto livre via WhatsApp Web, com timing entre envios e histórico de listas
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[rgba(59,130,246,0.1)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-[var(--accent-primary)] text-[var(--color-text-primary)]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>{current.render()}</div>
    </div>
  );
}
