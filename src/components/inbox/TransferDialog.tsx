import { useMemo, useState } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Operator } from '@/hooks/useOperators';
import type { Department } from '@/hooks/useDepartments';

interface Props {
  open: boolean;
  onClose: () => void;
  departments: Department[];
  operators: Operator[];
  currentDepartmentId: string | null;
  onTransfer: (dest: { userId: string | null; departmentId: string | null; reason: string }) => Promise<void>;
}

// Transferir é escolher UM destino: um setor (volta para a fila) ou uma pessoa.
// Deixar os dois abertos ao mesmo tempo convida à combinação "pessoa do setor A
// dentro do setor B", que é justamente o estado que as policies não enxergam.
export function TransferDialog({
  open, onClose, departments, operators, currentDepartmentId, onTransfer,
}: Props) {
  const [modo, setModo] = useState<'setor' | 'pessoa'>('setor');
  const [departmentId, setDepartmentId] = useState('');
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Transferir para o setor onde a conversa já está não é transferência.
  const setores = useMemo(
    () => departments.filter((d) => d.id !== currentDepartmentId),
    [departments, currentDepartmentId],
  );

  if (!open) return null;

  const destinoOk = modo === 'setor' ? departmentId !== '' : userId !== '';

  const submit = async () => {
    if (!destinoOk) return;
    setSaving(true);
    try {
      await onTransfer({
        userId: modo === 'pessoa' ? userId : null,
        departmentId: modo === 'setor' ? departmentId : null,
        reason: reason.trim(),
      });
      toast.success('Conversa transferida.');
      setReason('');
      setUserId('');
      setDepartmentId('');
      onClose();
    } catch (err) {
      toast.error('Não foi possível transferir', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="glass-card w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
            <ArrowRightLeft className="h-4 w-4 text-[var(--accent-primary)]" />
            Transferir conversa
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          {(['setor', 'pessoa'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={[
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                modo === m
                  ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.15)] text-[var(--color-text-primary)]'
                  : 'border-[rgba(59,130,246,0.15)] text-[var(--color-text-secondary)] hover:border-[rgba(59,130,246,0.35)]',
              ].join(' ')}
            >
              {m === 'setor' ? 'Para um setor' : 'Para uma pessoa'}
            </button>
          ))}
        </div>

        {modo === 'setor' ? (
          <div className="space-y-2">
            <div className="text-label">Setor de destino</div>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">Selecione…</option>
              {setores.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-text-secondary)]">
              A conversa entra na fila do setor, sem dono, para o supervisor distribuir.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-label">Pessoa</div>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">Selecione…</option>
              {operators.map((o) => (
                <option key={o.user_id} value={o.user_id}>{o.email}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-text-secondary)]">
              A conversa vai para o setor dessa pessoa, já atribuída a ela.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <div className="text-label">Motivo (opcional)</div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: assunto de folha, não de recrutamento"
            className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          />
          <p className="text-xs text-[var(--color-text-secondary)]">
            Fica como nota interna na conversa. O contato não vê.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[rgba(59,130,246,0.2)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!destinoOk || saving}
            className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'Transferindo…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  );
}
