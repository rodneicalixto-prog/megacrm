import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react';
import { useLegalDashboardStats } from '@/hooks/useLegalDashboardStats';
import type { LegalCaseOutcome, LegalCaseStatus } from '@/types/legal';

const STATUS_LABEL: Record<LegalCaseStatus, string> = {
  em_andamento: 'Em andamento',
  atrasado: 'Atrasado',
  elaborando_defesa: 'Elaborando defesa',
  pendente_documentacao: 'Pendente documentação',
  encerrado: 'Encerrado',
};

const OUTCOME_LABEL: Record<LegalCaseOutcome, string> = {
  acordo: 'Encerrado em acordo',
  procedente: 'Julgado procedente',
  improcedente: 'Julgado improcedente',
};

function BarRow({ label, value, max, colorClass }: { label: string; value: number; max: number; colorClass: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2fr_2.5rem] items-center gap-3 py-1.5 text-sm">
      <span className="truncate text-[var(--color-text-secondary)]">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

export default function LegalDashboardPage() {
  const { stats, loading } = useLegalDashboardStats();

  const statusEntries = Object.entries(stats?.volume_by_status ?? {}) as Array<[LegalCaseStatus, number]>;
  const outcomeEntries = Object.entries(stats?.outcome_breakdown ?? {}) as Array<[LegalCaseOutcome, number]>;
  const ranking = stats?.classification_ranking ?? [];
  const maxStatus = Math.max(1, ...statusEntries.map(([, v]) => v));
  const maxOutcome = Math.max(1, ...outcomeEntries.map(([, v]) => v));
  const maxCause = Math.max(1, ...ranking.map((r) => r.count));

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="flex items-center gap-4">
        <Link to="/juridico" className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl glass-card">
          <BarChart3 className="h-5 w-5 text-[var(--accent-secondary)]" />
        </div>
        <div>
          <div className="text-label">Jurídico</div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Painel de inteligência</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Volume, desfecho e ranking de causas — base para o plano de ação de prevenção.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-secondary)]" />
        </div>
      ) : (
        <>
          <div className="glass-card p-5">
            <h2 className="text-label mb-3">Processos por status</h2>
            {statusEntries.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Sem processos cadastrados ainda.</p>
            ) : (
              statusEntries.map(([status, count]) => (
                <BarRow key={status} label={STATUS_LABEL[status]} value={count} max={maxStatus} colorClass="bg-[var(--accent-primary)]" />
              ))
            )}
          </div>

          <div className="glass-card p-5">
            <h2 className="text-label mb-3">Desfecho dos encerrados</h2>
            {outcomeEntries.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Nenhum processo encerrado com desfecho registrado ainda.</p>
            ) : (
              outcomeEntries.map(([outcome, count]) => (
                <BarRow
                  key={outcome}
                  label={OUTCOME_LABEL[outcome]}
                  value={count}
                  max={maxOutcome}
                  colorClass={outcome === 'improcedente' ? 'bg-[#EF4444]' : outcome === 'procedente' ? 'bg-[#10B981]' : 'bg-[#FBBF24]'}
                />
              ))
            )}
          </div>

          <div className="glass-card p-5">
            <h2 className="text-label mb-3">Ranking de causas</h2>
            {ranking.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma classificação registrada ainda.</p>
            ) : (
              ranking.map((r, i) => (
                <BarRow key={r.classification} label={`${i + 1}º ${r.classification}`} value={r.count} max={maxCause} colorClass="bg-[#8B5CF6]" />
              ))
            )}
          </div>

          {ranking.length > 0 && (
            <div className="glass-card p-5">
              <h2 className="text-label mb-3">Plano de ação sugerido</h2>
              <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
                Conteúdo curado por causa — edite conforme a realidade da empresa, isto não vem do banco de dados.
              </p>
              <ul className="space-y-2 text-sm text-[var(--color-text-primary)]">
                <li className="rounded-lg bg-white/[0.03] p-3">
                  <b>{ranking[0].classification}</b> é a causa mais recorrente ({ranking[0].count} processo{ranking[0].count > 1 ? 's' : ''}) —
                  vale priorizar uma ação preventiva específica pra ela antes das demais.
                </li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
