import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useLegalActionPlans, type ActionPlanInput } from '@/hooks/useLegalActionPlans';
import { useOperators, operatorLabel } from '@/hooks/useOperators';
import type { LegalActionPlan, LegalActionPlanStatus } from '@/types/legal';

const STATUS_LABEL: Record<LegalActionPlanStatus, string> = {
  planejado: 'Planejado',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
};

// Uma linha por item da lista (sem editor chique de lista) — parse simples
// por quebra de linha, mesmo espírito de "checklist de texto" usado em
// outras partes do módulo Jurídico.
function linesToList(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}
function listToLines(list: string[] | undefined): string {
  return (list ?? []).join('\n');
}

interface ActionPlanDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  existing?: LegalActionPlan | null;
  defaultClassification?: string;
}

export function ActionPlanDialog({ open, onClose, onSaved, existing, defaultClassification }: ActionPlanDialogProps) {
  const { createPlan, updatePlan } = useLegalActionPlans();
  const { operators } = useOperators();
  const [saving, setSaving] = useState(false);

  const [classification, setClassification] = useState('');
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState<LegalActionPlanStatus>('planejado');
  const [strengths, setStrengths] = useState('');
  const [weaknesses, setWeaknesses] = useState('');
  const [opportunities, setOpportunities] = useState('');
  const [threats, setThreats] = useState('');
  const [what, setWhat] = useState('');
  const [why, setWhy] = useState('');
  const [where, setWhere] = useState('');
  const [when, setWhen] = useState('');
  const [who, setWho] = useState('');
  const [how, setHow] = useState('');
  const [howMuch, setHowMuch] = useState('');

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setClassification(existing.classification);
      setTitle(existing.title);
      setOwnerId(existing.owner_id ?? '');
      setStatus(existing.status);
      setStrengths(listToLines(existing.swot_strengths));
      setWeaknesses(listToLines(existing.swot_weaknesses));
      setOpportunities(listToLines(existing.swot_opportunities));
      setThreats(listToLines(existing.swot_threats));
      setWhat(existing.w5h2_what ?? '');
      setWhy(existing.w5h2_why ?? '');
      setWhere(existing.w5h2_where ?? '');
      setWhen(existing.w5h2_when ?? '');
      setWho(existing.w5h2_who ?? '');
      setHow(existing.w5h2_how ?? '');
      setHowMuch(existing.w5h2_how_much ?? '');
    } else {
      setClassification(defaultClassification ?? '');
      setTitle(''); setOwnerId(''); setStatus('planejado');
      setStrengths(''); setWeaknesses(''); setOpportunities(''); setThreats('');
      setWhat(''); setWhy(''); setWhere(''); setWhen(''); setWho(''); setHow(''); setHowMuch('');
    }
  }, [open, existing, defaultClassification]);

  const submit = async () => {
    if (!classification.trim()) { toast.error('Informe a classificação/causa.'); return; }
    if (!title.trim()) { toast.error('Informe um título pro plano.'); return; }

    const input: ActionPlanInput = {
      classification: classification.trim(),
      title: title.trim(),
      owner_id: ownerId || null,
      status,
      swot_strengths: linesToList(strengths),
      swot_weaknesses: linesToList(weaknesses),
      swot_opportunities: linesToList(opportunities),
      swot_threats: linesToList(threats),
      w5h2_what: what.trim() || null,
      w5h2_why: why.trim() || null,
      w5h2_where: where.trim() || null,
      w5h2_when: when || null,
      w5h2_who: who.trim() || null,
      w5h2_how: how.trim() || null,
      w5h2_how_much: howMuch.trim() || null,
    };

    setSaving(true);
    try {
      const res = existing ? await updatePlan(existing.id, input) : await createPlan(input);
      if (!res.ok) {
        toast.error('Falha ao salvar plano', { description: res.error });
        return;
      }
      toast.success(existing ? 'Plano atualizado.' : 'Plano criado.');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]';
  const textareaClass = `${inputClass} resize-none`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Editar plano de ação' : 'Novo plano de ação'}
      description="Plano de prevenção por causa — SWOT e 5W2H, com responsável pela implantação."
      widthClass="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label mb-1.5 block">Classificação / causa</label>
            <input value={classification} onChange={(e) => setClassification(e.target.value)} className={inputClass} placeholder="Horas extras e banco de horas" />
          </div>
          <div>
            <label className="text-label mb-1.5 block">Título do plano</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Formalizar acordos de banco de horas" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label mb-1.5 block">Responsável pela implantação</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass}>
              <option value="">Sem responsável definido</option>
              {operators.map((o) => <option key={o.user_id} value={o.user_id}>{operatorLabel(o)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-label mb-1.5 block">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as LegalActionPlanStatus)} className={inputClass}>
              {(Object.keys(STATUS_LABEL) as LegalActionPlanStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <h3 className="text-label mb-2 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-[#8B5CF6]" />Análise SWOT — uma linha por item</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Forças</label>
              <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={3} className={textareaClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Fraquezas</label>
              <textarea value={weaknesses} onChange={(e) => setWeaknesses(e.target.value)} rows={3} className={textareaClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Oportunidades</label>
              <textarea value={opportunities} onChange={(e) => setOpportunities(e.target.value)} rows={3} className={textareaClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Ameaças</label>
              <textarea value={threats} onChange={(e) => setThreats(e.target.value)} rows={3} className={textareaClass} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-label mb-2">5W2H</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">O quê (What)</label>
              <input value={what} onChange={(e) => setWhat(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Por quê (Why)</label>
              <input value={why} onChange={(e) => setWhy(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Onde (Where)</label>
              <input value={where} onChange={(e) => setWhere(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Quando (When)</label>
              <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Quem (Who)</label>
              <input value={who} onChange={(e) => setWho(e.target.value)} className={inputClass} placeholder="Time ou pessoa (texto livre)" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Como (How)</label>
              <input value={how} onChange={(e) => setHow(e.target.value)} className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-[var(--color-text-secondary)]">Quanto custa (How much)</label>
              <input value={howMuch} onChange={(e) => setHowMuch(e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {existing ? 'Salvar' : 'Criar plano'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
