import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAgenda } from '@/hooks/useAgenda';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Primeiro dia da grade: o domingo da semana em que cai o dia 1. Sem isso a
// primeira linha do mês começa desalinhada do cabeçalho.
function inicioDaGrade(mes: Date): Date {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const d = new Date(primeiro);
  d.setDate(primeiro.getDate() - primeiro.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AgendaPage() {
  const [mes, setMes] = useState(() => {
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  });

  const inicio = useMemo(() => inicioDaGrade(mes), [mes]);
  const fim = useMemo(() => {
    const d = new Date(inicio);
    d.setDate(d.getDate() + 42); // 6 semanas cobrem qualquer mês
    return d;
  }, [inicio]);

  const {
    events, calendars, loading, error, reload,
    companyCalendar, myCalendar, canWriteCompany, createEvent, deleteEvent,
  } = useAgenda(inicio, fim);

  const [novoDia, setNovoDia] = useState<Date | null>(null);
  const [titulo, setTitulo] = useState('');
  const [calendarioId, setCalendarioId] = useState('');
  const [inicioHora, setInicioHora] = useState('');
  const [fimHora, setFimHora] = useState('');
  const [salvando, setSalvando] = useState(false);

  const corPorCalendario = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.color);
    return m;
  }, [calendars]);

  const podeExcluir = (event: (typeof events)[number]) => {
    const calendar = calendars.find((c) => c.id === event.calendar_id);
    return calendar?.owner_id === myCalendar?.owner_id
      || Boolean(calendar?.is_company && canWriteCompany);
  };

  const dias = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      out.push(d);
    }
    return out;
  }, [inicio]);

  const eventosDoDia = (d: Date) =>
    events.filter((e) => {
      const ini = new Date(e.starts_at);
      const f = new Date(e.ends_at);
      const diaIni = new Date(d); diaIni.setHours(0, 0, 0, 0);
      const diaFim = new Date(d); diaFim.setHours(23, 59, 59, 999);
      return ini <= diaFim && f >= diaIni;
    });

  const abrirNovo = (d: Date) => {
    const base = new Date(d);
    base.setHours(9, 0, 0, 0);
    const fimBase = new Date(base);
    fimBase.setHours(10, 0, 0, 0);
    setNovoDia(d);
    setTitulo('');
    setInicioHora(paraInputLocal(base));
    setFimHora(paraInputLocal(fimBase));
    setCalendarioId(myCalendar?.id ?? companyCalendar?.id ?? '');
  };

  const salvar = async () => {
    if (!titulo.trim() || !calendarioId) return;
    setSalvando(true);
    try {
      await createEvent({
        calendar_id: calendarioId,
        title: titulo.trim(),
        starts_at: new Date(inicioHora).toISOString(),
        ends_at: new Date(fimHora).toISOString(),
      });
      toast.success('Compromisso criado.');
      setNovoDia(null);
    } catch (err) {
      toast.error('Não foi possível criar', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSalvando(false);
    }
  };

  const hoje = new Date();

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="icon-chip flex h-12 w-12 items-center justify-center rounded-xl">
            <CalendarDays className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-display text-2xl font-bold">Agenda</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
            aria-label="Mês anterior"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(59,130,246,0.2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-[170px] text-center text-sm font-semibold text-[var(--color-text-primary)]">
            {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </div>
          <button
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
            aria-label="Próximo mês"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(59,130,246,0.2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <div className="mb-3"><LoadErrorBanner message={error} onRetry={() => void reload()} /></div>}

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        {calendars.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
            {c.name}
            {c.is_company && !canWriteCompany ? (
              <span title="Somente gerência e diretoria escrevem aqui">
                <Lock className="h-3 w-3 opacity-60" />
              </span>
            ) : null}
          </span>
        ))}
      </div>

      <div className="glass-card min-h-0 flex-1 overflow-auto p-2">
        <div className="grid grid-cols-7 gap-1">
          {DIAS.map((d) => (
            <div key={d} className="text-label px-1 py-1 text-center">{d}</div>
          ))}
          {dias.map((d) => {
            const doMes = d.getMonth() === mes.getMonth();
            const evs = eventosDoDia(d);
            return (
              <div
                key={d.toISOString()}
                className={[
                  'group min-h-[92px] rounded-lg border p-1.5 transition-colors',
                  doMes
                    ? 'border-[rgba(59,130,246,0.12)] bg-white/[0.02]'
                    : 'border-transparent opacity-40',
                  mesmoDia(d, hoje) ? 'ring-1 ring-[var(--accent-primary)]' : '',
                ].join(' ')}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {d.getDate()}
                  </span>
                  <button
                    onClick={() => abrirNovo(d)}
                    aria-label={`Novo compromisso em ${d.toLocaleDateString('pt-BR')}`}
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-secondary)] opacity-0 transition hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="space-y-1">
                  {evs.map((e) => (
                    <div
                      key={e.id}
                      className="group/ev flex items-start gap-1 rounded px-1 py-0.5 text-[11px] leading-tight text-[var(--color-text-primary)]"
                      style={{ backgroundColor: `color-mix(in srgb, ${corPorCalendario.get(e.calendar_id) ?? 'var(--accent-primary)'} 13%, transparent)` }}
                    >
                      <span
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: corPorCalendario.get(e.calendar_id) ?? 'var(--accent-primary)' }}
                      />
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      {podeExcluir(e) && <button
                        onClick={async () => {
                          try {
                            await deleteEvent(e.id);
                          } catch (err) {
                            // A policy recusa apagar compromisso da empresa de
                            // quem não é gerência; a mensagem explica em vez de
                            // o clique não fazer nada.
                            toast.error('Não foi possível excluir', {
                              description: err instanceof Error ? err.message : 'Erro interno',
                            });
                          }
                        }}
                        aria-label={`Excluir ${e.title}`}
                        className="opacity-0 transition group-hover/ev:opacity-100"
                      >
                        <Trash2 className="h-3 w-3 text-[var(--color-error)]" />
                      </button>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {loading && <div className="p-4 text-center text-label opacity-60">Carregando…</div>}
      </div>

      {novoDia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-md p-5">
            <h2 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">
              Novo compromisso — {novoDia.toLocaleDateString('pt-BR')}
            </h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-label">Título</div>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-label">Calendário</div>
                <select
                  value={calendarioId}
                  onChange={(e) => setCalendarioId(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
                >
                  {calendars
                    // O da empresa só aparece para quem pode escrever nele.
                    .filter((c) => !c.is_company || canWriteCompany)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="text-label">Início</div>
                  <input
                    type="datetime-local"
                    value={inicioHora}
                    onChange={(e) => setInicioHora(e.target.value)}
                    className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-label">Fim</div>
                  <input
                    type="datetime-local"
                    value={fimHora}
                    onChange={(e) => setFimHora(e.target.value)}
                    className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setNovoDia(null)}
                className="rounded-lg border border-[rgba(59,130,246,0.2)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando || !titulo.trim() || !calendarioId || new Date(fimHora) <= new Date(inicioHora)}
                className="rounded-lg bg-[linear-gradient(135deg,#1E3A8A,var(--accent-primary))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {salvando ? 'Salvando…' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
