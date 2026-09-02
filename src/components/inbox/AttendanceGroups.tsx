import { useState } from 'react';
import { FolderPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AttendanceGroup } from '@/hooks/useAttendanceGroups';

interface Props {
  groups: AttendanceGroup[];
  selectedGroupId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function AttendanceGroups({ groups, selectedGroupId, onSelect, onCreate, onRemove }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await onCreate(name);
      setName('');
      setCreating(false);
    } catch (error) {
      toast.error('Não foi possível criar o grupo', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="border-t border-[rgba(59,130,246,0.08)] px-2 pb-3 pt-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-label">Grupos</span>
        <button type="button" onClick={() => setCreating((value) => !value)} aria-label="Criar grupo" className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-white/5">
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>
      {creating && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="mb-2 flex gap-1">
          <input autoFocus maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do grupo" className="min-w-0 flex-1 rounded-md border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1.5 text-xs" />
          <button className="rounded-md bg-[var(--accent-primary)] px-2 text-xs text-white">OK</button>
        </form>
      )}
      <div className="space-y-1">
        {groups.map((group) => (
          <div key={group.id} className="group flex items-center">
            <button type="button" onClick={() => onSelect(selectedGroupId === group.id ? null : group.id)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${selectedGroupId === group.id ? 'bg-[rgba(59,130,246,0.12)] text-[var(--accent-secondary)]' : 'hover:bg-white/[0.03]'}`}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
              <span className="truncate">{group.name}</span>
              <span className="ml-auto opacity-60">{group.conversationIds.length}</span>
            </button>
            <button type="button" aria-label={`Excluir grupo ${group.name}`} onClick={() => void onRemove(group.id)} className="p-1 opacity-0 group-hover:opacity-60 hover:!opacity-100"><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
        {!creating && groups.length === 0 && <p className="px-1 text-[11px] text-[var(--color-text-secondary)]">Crie listas privadas para organizar atendimentos.</p>}
      </div>
    </div>
  );
}
