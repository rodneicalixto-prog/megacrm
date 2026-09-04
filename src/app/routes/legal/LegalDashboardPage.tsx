import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BarChart3, Loader2, Pencil, Plus, ShieldAlert, Users2 } from 'lucide-react';
import { useLegalDashboardStats } from '@/hooks/useLegalDashboardStats';
import { useLegalActionPlans } from '@/hooks/useLegalActionPlans';
import { useOperators, operatorLabel } from '@/hooks/useOperators';
import { Button } from '@/components/ui/button';
import { ActionPlanDialog } from './ActionPlanDialog';
import type { LegalActionPlan, LegalActionPlanStatus, LegalCaseInstance, LegalCaseOutcome, LegalCaseStatus } from '@/types/legal';

const STATUS_LABEL: Record<LegalCaseStatus, string> = {
  em_andamento: 'Em andamento',
  atrasado: 'Atrasado',
  elaborando_defesa: 'Elaborando defesa',
  pendente_documentacao: 'Pendente documentação',
  encerrado: 'Encerrado',
};

// "procedente" = reclamação julgada procedente = decisão CONTRA a empresa (ruim);
// "improcedente" = reclamação negada = decisão A FAVOR da empresa (bom). Rótulo
// deixa a perspectiva explícita pra não depender de quem lê saber o jargão.
const OUTCOME_LABEL: Record<LegalCaseOutcome, string> = {
  acordo: 'Encerrado em acordo',
  procedente: 'Julgado contra a empresa (procedente)',
  improcedente: 'Julgado a favor da empresa (improcedente)',
};

const INSTANCE_LABEL: Record<LegalCaseInstance, string> = {
  primeira_instancia: '1ª instância',
  segunda_instancia: '2ª instância',
  terceira_instancia: '3ª instância',
  tribunal_superior: 'Tribunal superior',
};

const ACTION_STATUS_LABEL: Record<LegalActionPlanStatus, string> = {
  planejado: 'Planejado',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
};
const ACTION_STATUS_CLASS: Record<LegalActionPlanStatus, string> = {
  planejado: 'bg-white/5 text-[var(--color-text-secondary)]',
  em_andamento: 'bg-[rgba(245,158,11,0.14)] text-[#FBBF24]',
  concluido: 'bg-[rgba(16,185,129,0.14)] text-[#10B981]',
};

// Uma barra que também é link — os cards do painel "direcionam" pra lista de
// processos já filtrada, em vez de só mostrar o número.
function BarRow({ label, value, max, colorClass, to }: { label: string; value: number; max: number; colorClass: string; to?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const content = (
    <div className="grid grid-cols-[minmax(0,1fr)_2fr_2.5rem] items-center gap-3 py-1.5 text-sm">
      <span className="truncate text-[var(--color-text-secondary)]">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
  if (!to) return content;
  return (
    <Link to={to} className="-mx-2 block rounded-lg px-2 transition-colors hover:bg-white/5">
      {content}
    </Link>
  );
}

export default function LegalDashboardPage() {
  const { stats, loading } = useLegalDashboardStats();
  const { plans, loading: plansLoading, reload: reloadPlans } = useLegalActionPlans();
  const { operators } = useOperators();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<LegalActionPlan | null>(null);
  const [rankingYear, setRankingYear] = useState<string>('');

  const statusEntries = Object.entries(stats?.volume_by_status ?? {}) as Array<[LegalCaseStatus, number]>;
  const outcomeEntries = Object.entries(stats?.outcome_breakdown ?? {}) as Array<[LegalCaseOutcome, number]>;
  const instanceEntries = Object.entries(stats?.instance_breakdown ?? {}) as Array<[LegalCaseInstance, number]>;
  const yearEntries = useMemo(
    () => Object.entries(stats?.year_breakdown ?? {}).sort((a, b) => b[0].localeCompare(a[0])),
    [stats],
  );
  const ranking = stats?.classification_ranking ?? [];
  const shiftEntries = Object.entries(stats?.shift_breakdown ?? {});
  const employeeDeptEntries = Object.entries(stats?.employee_department_breakdown ?? {});
  const managerRanking = stats?.manager_ranking ?? [];
  const maxStatus = Math.max(1, ...statusEntries.map(([, v]) => v));
  const maxOutcome = Math.max(1, ...outcomeEntries.map(([, v]) => v));
  const maxInstance = Math.max(1, ...instanceEntries.map(([, v]) => v));
  const maxYear = Math.max(1, ...yearEntries.map(([, v]) => v));
  const maxCause = Math.max(1, ...ranking.map((r) => r.count));
  const maxShift = Math.max(1, ...shiftEntries.map(([, v]) => v));
  const maxManager = Math.max(1, ...managerRanking.map((m) => m.count));
  const maxEmployeeDept = Math.max(1, ...employeeDeptEntries.map(([, v]) => v));

  const ownerLabel = (id: string | null) => {
    if (!id) return 'Sem responsável';
    const op = operators.find((o) => o.user_id === id);
    return op ? operatorLabel(op) : 'Sem responsável';
  };

  const openNewPlan = () => { setEditingPlan(null); setDialogOpen(true); };
  const openEditPlan = (plan: LegalActionPlan) => { setEditingPlan(plan); setDialogOpen(true); };

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
            Volume, desfecho, instância e ano — cada linha leva direto pros processos daquele recorte.
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
                <BarRow key={status} label={STATUS_LABEL[status]} value={count} max={maxStatus} colorClass="bg-[var(--accent-primary)]" to={`/juridico?status=${status}`} />
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
                  to={`/juridico?outcome=${outcome}`}
                  colorClass={outcome === 'procedente' ? 'bg-[#EF4444]' : outcome === 'improcedente' ? 'bg-[#10B981]' : 'bg-[#FBBF24]'}
                />
              ))
            )}
          </div>

          <div className="glass-card p-5">
            <h2 className="text-label mb-3">Por instância</h2>
            {instanceEntries.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Sem processos cadastrados ainda.</p>
            ) : (
              instanceEntries.map(([instance, count]) => (
                <BarRow key={instance} label={INSTANCE_LABEL[instance]} value={count} max={maxInstance} colorClass="bg-[#60A5FA]" to={`/juridico?instance=${instance}`} />
              ))
            )}
          </div>

          <div className="glass-card p-5">
            <h2 className="text-label mb-3">Por ano</h2>
            {yearEntries.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Sem processos cadastrados ainda.</p>
            ) : (
              yearEntries.map(([year, count]) => (
                <BarRow key={year} label={year} value={count} max={maxYear} colorClass="bg-[#F59E0B]" to={`/juridico?year=${year}`} />
              ))
            )}
          </div>

          {/* Cruzamento com o contexto de RH — turno, gestor, setor do
              funcionário. Só aparece quando alguém já preencheu algo (senão
              três blocos vazios não ajudam ninguém). */}
          {(shiftEntries.length > 0 || managerRanking.length > 0 || employeeDeptEntries.length > 0) && (
            <>
              {shiftEntries.length > 0 && (
                <div className="glass-card p-5">
                  <h2 className="text-label mb-3">Reclamações por turno</h2>
                  {shiftEntries.map(([shift, count]) => (
                    <BarRow key={shift} label={shift} value={count} max={maxShift} colorClass="bg-[#22D3EE]" to={`/juridico?shift=${encodeURIComponent(shift)}`} />
                  ))}
                </div>
              )}
              {managerRanking.length > 0 && (
                <div className="glass-card p-5">
                  <h2 className="text-label mb-3">Reclamações por gestor</h2>
                  {managerRanking.map((m, i) => (
                    <BarRow key={m.manager} label={`${i + 1}º ${m.manager}`} value={m.count} max={maxManager} colorClass="bg-[#F472B6]" to={`/juridico?manager=${encodeURIComponent(m.manager)}`} />
                  ))}
                </div>
              )}
              {employeeDeptEntries.length > 0 && (
                <div className="glass-card p-5">
                  <h2 className="text-label mb-3">Reclamações por setor do funcionário</h2>
                  {employeeDeptEntries.map(([dept, count]) => (
                    <BarRow key={dept} label={dept} value={count} max={maxEmployeeDept} colorClass="bg-[#34D399]" to={`/juridico?employee_department=${encodeURIComponent(dept)}`} />
                  ))}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link to="/juridico?union=true" className="glass-card flex items-center gap-3 p-4 transition-colors hover:border-[rgba(59,130,246,0.4)]">
              <Users2 className="h-5 w-5 shrink-0 text-[#8B5CF6]" />
              <div>
                <div className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">{stats?.union_engaged_count ?? 0}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">Acionaram o sindicato</div>
              </div>
            </Link>
            <Link to="/juridico?warning=true" className="glass-card flex items-center gap-3 p-4 transition-colors hover:border-[rgba(59,130,246,0.4)]">
              <ShieldAlert className="h-5 w-5 shrink-0 text-[#FBBF24]" />
              <div>
                <div className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">{stats?.warning_or_suspension_count ?? 0}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">Com advertência/suspensão</div>
              </div>
            </Link>
            <Link to="/juridico?basket_missing=true" className="glass-card flex items-center gap-3 p-4 transition-colors hover:border-[rgba(59,130,246,0.4)]">
              <AlertTriangle className="h-5 w-5 shrink-0 text-[#EF4444]" />
              <div>
                <div className="text-lg font-bold tabular-nums text-[var(--color-text-primary)]">{stats?.basic_basket_missing_count ?? 0}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">Sem cesta básica no período</div>
              </div>
            </Link>
          </div>

          <div className="glass-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-label">Ranking de causas</h2>
              {yearEntries.length > 0 && (
                <select
                  value={rankingYear}
                  onChange={(e) => setRankingYear(e.target.value)}
                  className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                >
                  <option value="">Todos os anos</option>
                  {yearEntries.map(([year]) => <option key={year} value={year}>{year}</option>)}
                </select>
              )}
            </div>
            {/* O recorte por ano aqui só reordena/filtra este ranking — os KPIs
                acima (status/desfecho/instância) continuam somando todos os
                anos, porque o RPC hoje não cruza ano×causa. Deixado assim de
                propósito nesta rodada pra não precisar de uma agregação nova
                mais pesada; se isso virar necessidade real, o RPC ganha um
                parâmetro de ano. */}
            {rankingYear && (
              <p className="mb-2 text-[11px] text-[var(--color-text-secondary)]">
                Filtrando só este ranking por {rankingYear} — os números acima seguem somando todos os anos.
              </p>
            )}
            {ranking.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma classificação registrada ainda.</p>
            ) : (
              ranking.map((r, i) => (
                <BarRow
                  key={r.classification}
                  label={`${i + 1}º ${r.classification}`}
                  value={r.count}
                  max={maxCause}
                  colorClass="bg-[#8B5CF6]"
                  to={`/juridico?${rankingYear ? `year=${rankingYear}` : `status=em_andamento`}`}
                />
              ))
            )}
          </div>

          <div className="glass-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-label">Plano de ação de prevenção</h2>
              <Button type="button" variant="ghost" size="sm" onClick={openNewPlan}>
                <Plus className="h-3.5 w-3.5" />
                Novo plano
              </Button>
            </div>
            {plansLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-secondary)]" />
              </div>
            ) : plans.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Nenhum plano cadastrado ainda. {ranking.length > 0 && <>A causa mais recorrente hoje é <b>{ranking[0].classification}</b> — bom ponto de partida.</>}
              </p>
            ) : (
              <div className="space-y-2">
                {plans.map((plan) => (
                  <div key={plan.id} className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{plan.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ACTION_STATUS_CLASS[plan.status]}`}>
                          {ACTION_STATUS_LABEL[plan.status]}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        {plan.classification} · {ownerLabel(plan.owner_id)}
                      </div>
                    </div>
                    <button type="button" onClick={() => openEditPlan(plan)} className="shrink-0 text-[var(--color-text-secondary)] hover:text-[var(--accent-secondary)]">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <ActionPlanDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void reloadPlans()}
        existing={editingPlan}
        defaultClassification={ranking[0]?.classification}
      />
    </div>
  );
}
