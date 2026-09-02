import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Clock, Download, Inbox, MessageSquareWarning,
  Settings, Timer, Users,
} from 'lucide-react';
import { formatDuration, type AttendanceMetrics } from '@/hooks/useAttendanceMetrics';
import { operatorLabel, type Operator } from '@/hooks/useOperators';
import { downloadAttendanceCsv } from '@/lib/attendanceCsv';

// Painel operacional: quantas conversas estão paradas, com quem, e há quanto
// tempo. É o que o supervisor olha para decidir o próximo movimento.

function Card({
  icon: Icon, label, value, hint, tone = 'neutral', href,
}: {
  icon: typeof Inbox;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'warn' | 'danger' | 'ok';
  href: string;
}) {
  const toneClass = {
    neutral: 'text-[var(--accent-secondary)] border-[rgba(59,130,246,0.25)]',
    ok: 'text-[#10B981] border-[rgba(16,185,129,0.25)]',
    warn: 'text-[#FBBF24] border-[rgba(245,158,11,0.25)]',
    danger: 'text-[#EF4444] border-[rgba(239,68,68,0.25)]',
  }[tone];

  return (
    <Link
      to={href}
      className={'glass-card dashboard-interactive-card group block p-4 border focus-visible:border-[var(--accent-primary)] ' + toneClass}
      title={'Ver dados de ' + label}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-label">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-extrabold text-[var(--color-text-primary)]">{value}</div>
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{hint}</p> : null}
    </Link>
  );
}
// Barras dos 7 dias em CSS puro: sete valores não justificam carregar uma
// biblioteca de gráficos que já pesa 374 KB no bundle de outra rota.
function SevenDayChart({ data, inboxLink }: { data: { dia: string; novas: number }[]; inboxLink: (queue?: string, extra?: Record<string, string>) => string }) {
  const max = Math.max(1, ...data.map((d) => d.novas));
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label">Novas conversas · últimos 7 dias</span>
        <span className="text-[10px] text-[var(--color-text-secondary)]">Clique em um dia</span>
      </div>
      <div className="mt-4 flex h-28 items-end gap-2">
        {data.map((d) => (
          <Link
            key={d.dia}
            to={inboxLink(undefined, { fcr: d.dia, fst: '' })}
            aria-label={`Ver ${d.novas} conversa(s) criada(s) em ${new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR')}`}
            className="group/day flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-md px-0.5 transition-colors hover:bg-white/[0.04]"
          >
            <span className="text-[10px] text-[var(--color-text-secondary)]">{d.novas}</span>
            <div
              className="w-full rounded-t bg-gradient-to-t from-[#1E3A8A] to-[#3B82F6] transition-[filter,transform] duration-150 group-hover/day:brightness-125 group-hover/day:-translate-y-0.5"
              style={{ height: `${Math.max(4, (d.novas / max) * 100)}%` }}
              title={`${d.novas} conversa(s)`}
            />
            <span className="text-[10px] text-[var(--color-text-secondary)]">
              {new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
          </Link>
        ))}
        {data.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Sem conversas no período.</p>
        ) : null}
      </div>
    </div>
  );
}

export function AttendancePanel({
  metrics, operators, inboxScope = '',
}: {
  metrics: AttendanceMetrics;
  operators: Operator[];
  inboxScope?: string;
}) {
  const nameOf = (userId: string) => {
    const operator = operators.find((item) => item.user_id === userId);
    return operator ? operatorLabel(operator) : 'Sem responsável';
  };

  const comCarga = metrics.por_agente.filter((a) => a.abertas > 0 || a.fechadas_hoje > 0);
  const inboxLink = (queue?: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams(inboxScope);
    if (queue) params.set('fq', queue);
    for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
    return '/inbox?' + params.toString();
  };
  const todayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const todayPart = (type: Intl.DateTimeFormatPartTypes) =>
    todayParts.find((item) => item.type === type)?.value ?? '';
  const todaySaoPaulo = `${todayPart('year')}-${todayPart('month')}-${todayPart('day')}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => downloadAttendanceCsv(metrics, operators)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[rgba(59,130,246,0.25)] bg-white/[0.03] px-4 text-sm font-medium text-[var(--color-text-primary)] transition hover:border-[var(--accent-primary)] hover:bg-white/[0.06]"
        >
          <Download className="h-4 w-4 text-[var(--accent-secondary)]" />
          Exportar relatório CSV
        </button>
      </div>

      {/* Fila e volume */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          icon={Inbox}
          label="Aguardando"
          value={metrics.aguardando}
          hint="Abertas, sem responsável"
          tone={metrics.aguardando > 0 ? 'warn' : 'neutral'}
          href={inboxLink('nao_atribuidos')}
        />
        <Card icon={Users} label="Em andamento" value={metrics.em_andamento} hint="Já atribuídas" href={inboxLink('em_atendimento')} />
        <Card
          icon={MessageSquareWarning}
          label="Sem resposta"
          value={metrics.sem_resposta}
          hint="A última palavra foi do cliente"
          tone={metrics.sem_resposta > 0 ? 'danger' : 'ok'}
          href={inboxLink('aguardando')}
        />
        <Card
          icon={CheckCircle2}
          label="Finalizados hoje"
          value={metrics.finalizados_hoje}
          hint="Encerrados desde 00h · São Paulo"
          tone="ok"
          href={inboxLink('encerrados', { fcl: todaySaoPaulo })}
        />
      </div>

      {/* Tempos e presença */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          icon={Timer}
          label="1ª resposta (média)"
          value={formatDuration(metrics.tempo_medio_primeira_resposta)}
          hint="Do 1º contato à 1ª resposta humana"
          href={inboxLink()}
        />
        <Card
          icon={Clock}
          label="Duração do atendimento"
          value={formatDuration(metrics.tempo_medio_atendimento)}
          hint="Da abertura ao encerramento"
          href={inboxLink()}
        />
        <Card
          icon={Users}
          label="Atendentes online"
          value={`${metrics.agentes_online}/${metrics.agentes_total}`}
          tone={metrics.agentes_online > 0 ? 'ok' : 'warn'}
          href="/settings/team"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SevenDayChart data={metrics.serie_7_dias} inboxLink={inboxLink} />

        {/* Conversas por atendente */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-label">Conversas por atendente</span>
            <Link to={inboxLink()} className="text-xs font-medium text-[var(--accent-secondary)] hover:underline">Ver todas</Link>
          </div>
          <div className="mt-3 space-y-2">
            {comCarga.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Nenhuma conversa atribuída no momento.
              </p>
            ) : (
              comCarga.map((a) => (
                <Link key={a.user_id} to={inboxLink(undefined, { fas: a.user_id })} className="dashboard-interactive-row flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${a.is_online ? 'bg-[#10B981]' : 'bg-[var(--color-text-secondary)]'}`}
                      title={a.is_online ? 'Online' : 'Offline'}
                    />
                    <span className="truncate text-[var(--color-text-primary)]">{nameOf(a.user_id)}</span>
                  </span>
                  <span className="shrink-0 text-[var(--color-text-secondary)]">
                    <strong className="text-[var(--color-text-primary)]">{a.abertas}</strong> abertas
                    {a.fechadas_hoje > 0 ? ` · ${a.fechadas_hoje} hoje` : ''}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Alertas de conversa parada */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`h-4 w-4 ${metrics.paradas.length ? 'text-[#EF4444]' : 'text-[#10B981]'}`} />
          <span className="text-label">Conversas paradas</span>
          {metrics.paradas.length > 0 ? (
            <span className="rounded-full bg-[rgba(239,68,68,0.14)] px-2 py-0.5 text-[10px] font-semibold text-[#EF4444]">
              {metrics.paradas.length}
            </span>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {metrics.paradas.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Nenhuma conversa esperando há mais de 24h.
            </p>
          ) : (
            metrics.paradas.slice(0, 8).map((p) => (
              <Link
                key={p.conversation_id}
                to={`/inbox?conversation=${p.conversation_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(239,68,68,0.15)] px-3 py-2 text-sm transition hover:border-[#EF4444]"
              >
                <span className="min-w-0 truncate text-[var(--color-text-primary)]">
                  {p.contact_name || p.contact_phone || 'Contato'}
                </span>
                <span className="shrink-0 text-[#EF4444]">{p.horas_parada}h sem resposta</span>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Atalhos */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { to: '/inbox', label: 'Caixa de entrada', icon: Inbox },
          { to: '/settings/team', label: 'Equipe', icon: Users },
          { to: '/settings/profile', label: 'Configurações', icon: Settings },
        ].map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="glass-card flex items-center gap-3 p-4 transition hover:border-[var(--accent-primary)]"
          >
            <Icon className="h-4 w-4 text-[var(--accent-secondary)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
