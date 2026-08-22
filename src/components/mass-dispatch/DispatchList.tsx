import { useState } from 'react';
import { toast } from 'sonner';
import { Pause, Play, Plus, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMassDispatches } from '@/hooks/useMassDispatches';
import { DispatchWizard } from './DispatchWizard';
import { DispatchDetail } from './DispatchDetail';
import { MASS_DISPATCH_STATUS_LABEL, type MassDispatch, type MassDispatchStatus } from '@/types/massDispatch';

const STATUS_STYLE: Record<MassDispatchStatus, string> = {
  draft: 'bg-white/5 text-[var(--color-text-secondary)]',
  scheduled: 'bg-[rgba(96,165,250,0.14)] text-[#60A5FA]',
  sending: 'bg-[rgba(16,185,129,0.14)] text-[#10B981]',
  paused: 'bg-[rgba(245,158,11,0.14)] text-[#FBBF24]',
  completed: 'bg-[rgba(59,130,246,0.14)] text-[var(--accent-primary)]',
  failed: 'bg-[rgba(239,68,68,0.14)] text-[#F87171]',
};

export function DispatchList() {
  const { dispatches, loading, error, pause, resume, remove } = useMassDispatches();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<MassDispatch | null>(null);

  const handlePause = async (id: string) => {
    try {
      await pause(id);
    } catch (err) {
      toast.error('Falha ao pausar', { description: err instanceof Error ? err.message : String(err) });
    }
  };
  const handleResume = async (id: string) => {
    try {
      await resume(id);
    } catch (err) {
      toast.error('Falha ao retomar', { description: err instanceof Error ? err.message : String(err) });
    }
  };
  const handleRemove = async (d: MassDispatch) => {
    if (!confirm(`Excluir o disparo "${d.name}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await remove(d.id);
      toast.success('Disparo excluído.');
    } catch (err) {
      toast.error('Falha ao excluir', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Disparos em massa via WhatsApp Web — mensagens de texto livre, várias variações e timing entre envios.
        </p>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" /> Novo disparo
        </Button>
      </div>

      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Carregando…</p>}

      {!loading && dispatches.length === 0 && (
        <div className="glass-card p-10 text-center">
          <Send className="mx-auto mb-3 h-8 w-8 text-[var(--color-text-secondary)] opacity-50" />
          <p className="text-sm text-[var(--color-text-secondary)]">Nenhum disparo criado ainda.</p>
        </div>
      )}

      <div className="space-y-2">
        {dispatches.map((d) => (
          <div key={d.id} className="glass-card flex items-center gap-4 p-4">
            <button onClick={() => setSelected(d)} className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--color-text-primary)]">{d.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[d.status]}`}>
                  {MASS_DISPATCH_STATUS_LABEL[d.status]}
                </span>
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {d.total_contacts} destinatários · {d.sent} enviados · {d.replied} respostas · {d.failed} falhas
              </div>
            </button>
            <div className="flex items-center gap-1">
              {d.status === 'sending' && (
                <button title="Pausar" onClick={() => void handlePause(d.id)} className="rounded p-2 text-[var(--color-text-secondary)] hover:text-[#FBBF24]">
                  <Pause className="h-4 w-4" />
                </button>
              )}
              {d.status === 'paused' && (
                <button title="Retomar" onClick={() => void handleResume(d.id)} className="rounded p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-success)]">
                  <Play className="h-4 w-4" />
                </button>
              )}
              <button title="Excluir" onClick={() => void handleRemove(d)} className="rounded p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <DispatchWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      {selected && <DispatchDetail dispatch={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
