import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart3, FileUp, Loader2, Plus, Scale, Search, X } from 'lucide-react';
import { NewIntimationDialog } from './NewIntimationDialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useLegalCases, type CreateLegalCaseInput } from '@/hooks/useLegalCases';
import { useLegalEmployeeContexts } from '@/hooks/useLegalEmployeeContexts';
import { useDepartments } from '@/hooks/useDepartments';
import { useOperators, operatorLabel } from '@/hooks/useOperators';
import { dueBadge } from '@/lib/nextAction';
import type { LegalCase, LegalCaseInstance, LegalCaseStatus } from '@/types/legal';

const STATUS_LABEL: Record<LegalCaseStatus, string> = {
  em_andamento: 'Em andamento',
  atrasado: 'Atrasado',
  elaborando_defesa: 'Elaborando defesa',
  pendente_documentacao: 'Pendente documentação',
  encerrado: 'Encerrado',
};

const INSTANCE_LABEL: Record<LegalCaseInstance, string> = {
  primeira_instancia: '1ª instância',
  segunda_instancia: '2ª instância',
  terceira_instancia: '3ª instância',
  tribunal_superior: 'Tribunal superior',
};

const OUTCOME_LABEL: Record<string, string> = {
  acordo: 'Encerrado em acordo',
  procedente: 'Julgado contra a empresa (procedente)',
  improcedente: 'Julgado a favor da empresa (improcedente)',
};

function NewCaseDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { createCase } = useLegalCases();
  const { departments } = useDepartments();
  const { operators } = useOperators();
  const [title, setTitle] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [deadlineLabel, setDeadlineLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle(''); setCaseNumber(''); setDepartmentId(''); setOwnerId('');
    setDeadlineAt(''); setDeadlineLabel('');
  };

  const submit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { toast.error('Informe um título para o processo.'); return; }
    if (!departmentId) { toast.error('Selecione o setor responsável.'); return; }

    const input: CreateLegalCaseInput = {
      title: trimmedTitle,
      department_id: departmentId,
      case_number: caseNumber.trim() || null,
      owner_id: ownerId || null,
      next_deadline_at: deadlineAt ? new Date(deadlineAt).toISOString() : null,
      next_deadline_label: deadlineLabel.trim() || null,
    };

    setSaving(true);
    try {
      const res = await createCase(input);
      if (!res.ok) {
        toast.error('Falha ao criar processo', { description: res.error });
        return;
      }
      toast.success('Processo criado.');
      reset();
      onCreated(res.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Novo processo" description="Cria o processo jurídico — anexos, tarefas e testemunhas ficam disponíveis depois de criado." widthClass="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="text-label mb-1.5 block">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Reclamação trabalhista — horas extras"
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label mb-1.5 block">Nº do processo (opcional)</label>
            <input
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="0012345-67.2026.5.02.0043"
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>
          <div>
            <label className="text-label mb-1.5 block">Setor</label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            >
              <option value="">Selecione…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-label mb-1.5 block">Responsável interno (opcional)</label>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          >
            <option value="">Sem responsável definido</option>
            {operators.map((o) => (
              <option key={o.user_id} value={o.user_id}>{operatorLabel(o)}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label mb-1.5 block">Próximo prazo (opcional)</label>
            <input
              type="datetime-local"
              value={deadlineAt}
              onChange={(e) => setDeadlineAt(e.target.value)}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>
          <div>
            <label className="text-label mb-1.5 block">O que é o prazo</label>
            <input
              value={deadlineLabel}
              onChange={(e) => setDeadlineLabel(e.target.value)}
              placeholder="Audiência de instrução"
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Criar processo
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CaseCard({ legalCase, departmentName, ownerName }: { legalCase: LegalCase; departmentName: string | null; ownerName: string | null }) {
  const badge = legalCase.next_deadline_at ? dueBadge(legalCase.next_deadline_at) : null;
  return (
    <Link to={`/juridico/${legalCase.id}`} className="glass-card block p-5 transition-colors hover:border-[rgba(59,130,246,0.4)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
            {departmentName ?? 'Setor não definido'}
          </div>
          <h3 className="mt-0.5 text-base font-semibold text-[var(--color-text-primary)]">{legalCase.title}</h3>
          {legalCase.case_number && (
            <span className="text-xs text-[var(--color-text-secondary)]">Nº {legalCase.case_number}</span>
          )}
        </div>
        {badge && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}>
            {badge.short}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(59,130,246,0.08)] pt-3">
        <span className="text-xs text-[var(--color-text-secondary)]">{ownerName ?? 'Sem responsável'}</span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          {STATUS_LABEL[legalCase.status]}
        </span>
      </div>
    </Link>
  );
}

export default function LegalCasesPage() {
  const { cases, loading } = useLegalCases();
  const { contexts: employeeContexts } = useLegalEmployeeContexts();
  const { departments } = useDepartments();
  const { operators } = useOperators();
  const [showNew, setShowNew] = useState(false);
  const [showIntimation, setShowIntimation] = useState(false);
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtros vindos dos cards clicáveis do painel de inteligência
  // (?status=/?outcome=/?instance=/?year=) — aplicados em cima da lista já
  // carregada, mesmo espírito do filtro de busca por texto abaixo.
  const statusFilter = searchParams.get('status') as LegalCaseStatus | null;
  const outcomeFilter = searchParams.get('outcome');
  const instanceFilter = searchParams.get('instance') as LegalCaseInstance | null;
  const yearFilter = searchParams.get('year');
  const shiftFilter = searchParams.get('shift');
  const managerFilter = searchParams.get('manager');
  const employeeDeptFilter = searchParams.get('employee_department');
  const unionFilter = searchParams.get('union'); // 'true'
  const warningFilter = searchParams.get('warning'); // 'true'
  const basketMissingFilter = searchParams.get('basket_missing'); // 'true'
  const hasUrlFilter = Boolean(
    statusFilter || outcomeFilter || instanceFilter || yearFilter
    || shiftFilter || managerFilter || employeeDeptFilter || unionFilter || warningFilter || basketMissingFilter,
  );

  const clearUrlFilter = () => setSearchParams({});

  const departmentName = useMemo(() => {
    const map = new Map(departments.map((d) => [d.id, d.name]));
    return (id: string) => map.get(id) ?? null;
  }, [departments]);

  const ownerName = useMemo(() => {
    const map = new Map(operators.map((o) => [o.user_id, operatorLabel(o)]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [operators]);

  const employeeContextByCase = useMemo(() => {
    const map = new Map(employeeContexts.map((ec) => [ec.case_id, ec]));
    return map;
  }, [employeeContexts]);

  const filtered = useMemo(() => {
    let list = cases;
    if (statusFilter) list = list.filter((c) => c.status === statusFilter);
    if (outcomeFilter) list = list.filter((c) => c.outcome === outcomeFilter);
    if (instanceFilter) list = list.filter((c) => c.instance === instanceFilter);
    if (yearFilter) list = list.filter((c) => new Date(c.created_at).getFullYear().toString() === yearFilter);
    if (shiftFilter) list = list.filter((c) => employeeContextByCase.get(c.id)?.shift === shiftFilter);
    if (managerFilter) list = list.filter((c) => employeeContextByCase.get(c.id)?.manager_name === managerFilter);
    if (employeeDeptFilter) list = list.filter((c) => employeeContextByCase.get(c.id)?.department === employeeDeptFilter);
    if (unionFilter === 'true') list = list.filter((c) => employeeContextByCase.get(c.id)?.union_engaged === true);
    if (warningFilter === 'true') list = list.filter((c) => {
      const ec = employeeContextByCase.get(c.id);
      return Boolean(ec?.had_written_warning || ec?.had_suspension);
    });
    if (basketMissingFilter === 'true') list = list.filter((c) => employeeContextByCase.get(c.id)?.received_basic_basket_in_period === false);

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) =>
      c.title.toLowerCase().includes(q)
      || (c.case_number ?? '').toLowerCase().includes(q)
      || (c.classification ?? '').toLowerCase().includes(q));
  }, [
    cases, query, statusFilter, outcomeFilter, instanceFilter, yearFilter,
    shiftFilter, managerFilter, employeeDeptFilter, unionFilter, warningFilter, basketMissingFilter,
    employeeContextByCase,
  ]);

  const activeFilterLabel = statusFilter
    ? `Status: ${STATUS_LABEL[statusFilter]}`
    : outcomeFilter
      ? `Desfecho: ${OUTCOME_LABEL[outcomeFilter] ?? outcomeFilter}`
      : instanceFilter
        ? `Instância: ${INSTANCE_LABEL[instanceFilter]}`
        : yearFilter
          ? `Ano: ${yearFilter}`
          : shiftFilter
            ? `Turno: ${shiftFilter}`
            : managerFilter
              ? `Gestor: ${managerFilter}`
              : employeeDeptFilter
                ? `Setor do funcionário: ${employeeDeptFilter}`
                : unionFilter === 'true'
                  ? 'Sindicato acionado'
                  : warningFilter === 'true'
                    ? 'Com advertência/suspensão'
                    : basketMissingFilter === 'true'
                      ? 'Não recebeu cesta básica no período'
                      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl glass-card">
            <Scale className="h-5 w-5 text-[var(--accent-secondary)]" />
          </div>
          <div>
            <div className="text-label">Jurídico</div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Processos</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Audiências, prazos, tarefas e defesa — restrito a quem tem acesso ao módulo Jurídico.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/juridico/painel">
            <Button type="button" variant="outline">
              <BarChart3 className="h-4 w-4" />
              Painel de inteligência
            </Button>
          </Link>
          <Button type="button" variant="outline" onClick={() => setShowIntimation(true)}>
            <FileUp className="h-4 w-4" />
            Nova intimação
          </Button>
          <Button type="button" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            Novo processo
          </Button>
        </div>
      </header>

      {hasUrlFilter && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-[rgba(59,130,246,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
            {activeFilterLabel}
            <button type="button" onClick={clearUrlFilter} aria-label="Limpar filtro" className="hover:text-[var(--color-text-primary)]">
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, número ou classificação…"
          className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] py-2.5 pl-10 pr-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-secondary)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-2 py-16 text-center">
          <Scale className="h-8 w-8 text-[var(--color-text-secondary)]" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {cases.length === 0 ? 'Nenhum processo cadastrado ainda.' : 'Nenhum processo encontrado para essa busca.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((c) => (
            <CaseCard key={c.id} legalCase={c} departmentName={departmentName(c.department_id)} ownerName={ownerName(c.owner_id)} />
          ))}
        </div>
      )}

      <NewCaseDialog open={showNew} onClose={() => setShowNew(false)} onCreated={() => {}} />
      <NewIntimationDialog open={showIntimation} onClose={() => setShowIntimation(false)} />
    </div>
  );
}
