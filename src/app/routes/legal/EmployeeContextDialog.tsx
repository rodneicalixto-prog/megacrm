import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { LegalCaseEmployeeContext } from '@/types/legal';

// Tri-state honesto: não presume sim nem não até alguém marcar. Renderizado
// como 3 botões (Sim/Não/Não verificado) em vez de checkbox comum.
function TriState({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opt = (v: boolean | null, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
        value === v
          ? 'bg-[var(--accent-primary)] text-white'
          : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-1.5">
      {opt(true, 'Sim')}
      {opt(false, 'Não')}
      {opt(null, 'Não verificado')}
    </div>
  );
}

interface EmployeeContextDialogProps {
  open: boolean;
  onClose: () => void;
  existing: LegalCaseEmployeeContext | null;
  onSave: (input: Partial<Omit<LegalCaseEmployeeContext, 'id' | 'case_id' | 'created_at' | 'updated_at' | 'created_by'>>) => Promise<{ ok: boolean; error?: string }>;
}

export function EmployeeContextDialog({ open, onClose, existing, onSave }: EmployeeContextDialogProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [manager, setManager] = useState('');
  const [shift, setShift] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [terminationDate, setTerminationDate] = useState('');
  const [hadWarning, setHadWarning] = useState(false);
  const [hadSuspension, setHadSuspension] = useState(false);
  const [warningNotes, setWarningNotes] = useState('');
  const [hadAbandonment, setHadAbandonment] = useState(false);
  const [gotBasket, setGotBasket] = useState<boolean | null>(null);
  const [basketNotes, setBasketNotes] = useState('');
  const [unionEngaged, setUnionEngaged] = useState(false);
  const [unionNotes, setUnionNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(existing?.employee_name ?? '');
    setDepartment(existing?.department ?? '');
    setRoleTitle(existing?.role_title ?? '');
    setManager(existing?.manager_name ?? '');
    setShift(existing?.shift ?? '');
    setHireDate(existing?.hire_date ?? '');
    setTerminationDate(existing?.termination_date ?? '');
    setHadWarning(existing?.had_written_warning ?? false);
    setHadSuspension(existing?.had_suspension ?? false);
    setWarningNotes(existing?.warning_suspension_notes ?? '');
    setHadAbandonment(existing?.had_abandonment_notice ?? false);
    setGotBasket(existing?.received_basic_basket_in_period ?? null);
    setBasketNotes(existing?.basic_basket_notes ?? '');
    setUnionEngaged(existing?.union_engaged ?? false);
    setUnionNotes(existing?.union_notes ?? '');
  }, [open, existing]);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await onSave({
        employee_name: name.trim() || null,
        department: department.trim() || null,
        role_title: roleTitle.trim() || null,
        manager_name: manager.trim() || null,
        shift: shift.trim() || null,
        hire_date: hireDate || null,
        termination_date: terminationDate || null,
        had_written_warning: hadWarning,
        had_suspension: hadSuspension,
        warning_suspension_notes: warningNotes.trim() || null,
        had_abandonment_notice: hadAbandonment,
        received_basic_basket_in_period: gotBasket,
        basic_basket_notes: basketNotes.trim() || null,
        union_engaged: unionEngaged,
        union_notes: unionNotes.trim() || null,
      });
      if (!res.ok) { toast.error('Falha ao salvar', { description: res.error }); return; }
      toast.success('Contexto do funcionário salvo.');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]';
  const checkRow = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent-primary)]" />
      {label}
    </label>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Contexto do funcionário (RH)" description="Dados internos do reclamante — cruzam com o painel de inteligência (turno, gestor, setor)." widthClass="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-label mb-1.5 block">Nome</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></div>
          <div><label className="text-label mb-1.5 block">Setor</label><input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} /></div>
          <div><label className="text-label mb-1.5 block">Função</label><input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className={inputClass} /></div>
          <div><label className="text-label mb-1.5 block">Gestor</label><input value={manager} onChange={(e) => setManager(e.target.value)} className={inputClass} /></div>
          <div><label className="text-label mb-1.5 block">Turno</label><input value={shift} onChange={(e) => setShift(e.target.value)} className={inputClass} placeholder="Manhã, Tarde, Noite, Comercial…" /></div>
          <div />
          <div><label className="text-label mb-1.5 block">Data de admissão</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={inputClass} /></div>
          <div><label className="text-label mb-1.5 block">Data de desligamento</label><input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} className={inputClass} /></div>
        </div>

        <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
          {checkRow(hadWarning, setHadWarning, 'Recebeu advertência')}
          {checkRow(hadSuspension, setHadSuspension, 'Recebeu suspensão')}
          <textarea value={warningNotes} onChange={(e) => setWarningNotes(e.target.value)} rows={2} placeholder="Detalhes de advertência/suspensão…" className={`${inputClass} resize-none`} />
        </div>

        {checkRow(hadAbandonment, setHadAbandonment, 'Recebeu aviso de abandono de emprego')}

        <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text-primary)]">Recebeu cesta básica no período</span>
            <TriState value={gotBasket} onChange={setGotBasket} />
          </div>
          {gotBasket === false && (
            <p className="text-[11px] text-[#FBBF24]">Indício de falta com direito a receber, conforme regra interna — documentar abaixo.</p>
          )}
          <textarea value={basketNotes} onChange={(e) => setBasketNotes(e.target.value)} rows={2} placeholder="Notas…" className={`${inputClass} resize-none`} />
        </div>

        <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
          {checkRow(unionEngaged, setUnionEngaged, 'Acionou o sindicato')}
          <textarea value={unionNotes} onChange={(e) => setUnionNotes(e.target.value)} rows={2} placeholder="Notas…" className={`${inputClass} resize-none`} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
