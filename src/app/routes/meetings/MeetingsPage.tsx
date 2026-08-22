import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock, ChevronDown, ExternalLink, FileText, Loader2, Plus, Search, Sparkles, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useMeetings } from '@/hooks/useMeetings';
import { useDepartments } from '@/hooks/useDepartments';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { Meeting, MeetingStatus } from '@/types/meetings';

const STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: 'Agendada',
  recording: 'Gravando',
  processing: 'Processando',
  completed: 'Concluída',
  failed: 'Falhou',
  canceled: 'Cancelada',
};

const STATUS_CLASS: Record<MeetingStatus, string> = {
  scheduled: 'bg-[rgba(59,130,246,0.12)] text-[#60A5FA]',
  recording: 'bg-[rgba(239,68,68,0.12)] text-[#EF4444]',
  processing: 'bg-[rgba(245,158,11,0.12)] text-[#FBBF24]',
  completed: 'bg-[rgba(16,185,129,0.12)] text-[#10B981]',
  failed: 'bg-[rgba(239,68,68,0.12)] text-[#EF4444]',
  canceled: 'bg-white/5 text-[var(--color-text-secondary)]',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Igual ao helper de AgendaPage.tsx: valor pro <input type="datetime-local">,
// em horário local (não UTC) — senão o campo mostra um horário deslocado.
function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultStart(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30 - (d.getMinutes() % 15), 0, 0); // arredonda pra próximo quarto de hora
  return d;
}

function ScheduleDialog({ open, onClose, onScheduled }: { open: boolean; onClose: () => void; onScheduled: () => void }) {
  const { schedule } = useMeetings();
  const { departments } = useDepartments();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(defaultStart()));
  const [endsAt, setEndsAt] = useState(() => {
    const d = defaultStart();
    d.setMinutes(d.getMinutes() + 30);
    return toLocalInputValue(d);
  });
  const [attendeesText, setAttendeesText] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle(''); setDescription(''); setDepartmentId('');
    setStartsAt(toLocalInputValue(defaultStart()));
    const d = defaultStart(); d.setMinutes(d.getMinutes() + 30);
    setEndsAt(toLocalInputValue(d));
    setAttendeesText('');
  };

  const submit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { toast.error('Informe um título.'); return; }
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      toast.error('Verifique as datas — o fim precisa ser depois do início.');
      return;
    }
    const attendees = attendeesText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

    setSaving(true);
    try {
      const res = await schedule({
        title: trimmedTitle,
        description: description.trim() || undefined,
        department_id: departmentId || null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        attendees,
      });
      if (!res.ok) {
        toast.error('Falha ao agendar reunião', { description: res.error });
        return;
      }
      if (res.recall_warning) {
        toast.warning('Reunião criada, mas sem gravação automática', { description: res.recall_warning });
      } else {
        toast.success('Reunião agendada — link do Meet gerado.');
      }
      reset();
      onScheduled();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Nova reunião" description="Gera o link do Google Meet automaticamente na agenda compartilhada." widthClass="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="text-label mb-1.5 block">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Alinhamento semanal — Comercial"
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          />
        </div>
        <div>
          <label className="text-label mb-1.5 block">Descrição (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)] resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label mb-1.5 block">Início</label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>
          <div>
            <label className="text-label mb-1.5 block">Fim</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>
        </div>
        <div>
          <label className="text-label mb-1.5 block">Departamento (opcional)</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          >
            <option value="">Geral (sem departamento)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-label mb-1.5 block">Convidados (e-mails, separados por vírgula)</label>
          <input
            value={attendeesText}
            onChange={(e) => setAttendeesText(e.target.value)}
            placeholder="fulano@empresa.com, ciclana@empresa.com"
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            Agendar reunião
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function MeetingCard({ meeting, departmentName, canManage, onCancel }: {
  meeting: Meeting;
  departmentName: string | null;
  canManage: boolean;
  onCancel: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasArchive = Boolean(meeting.transcript || meeting.summary || meeting.recording_url);

  return (
    <div className="glass-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{meeting.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLASS[meeting.status]}`}>
              {STATUS_LABEL[meeting.status]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatDateTime(meeting.starts_at)}</span>
            {departmentName && <span>{departmentName}</span>}
            {meeting.attendees.length > 0 && <span>{meeting.attendees.length} convidado{meeting.attendees.length > 1 ? 's' : ''}</span>}
          </div>
          {meeting.description && (
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{meeting.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meeting.meet_link && meeting.status !== 'canceled' && (
            <a href={meeting.meet_link} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink className="h-3.5 w-3.5" />
                Entrar
              </Button>
            </a>
          )}
          {canManage && (meeting.status === 'scheduled' || meeting.status === 'recording') && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onCancel(meeting.id)}>
              <X className="h-3.5 w-3.5" />
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {meeting.error_message && meeting.status === 'failed' && (
        <p className="mt-3 rounded-lg border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] p-2 text-xs text-[#EF4444]">
          {meeting.error_message}
        </p>
      )}

      {hasArchive && (
        <div className="mt-3 border-t border-[rgba(59,130,246,0.08)] pt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-secondary)]"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Ocultar' : 'Ver'} gravação, transcrição e resumo
          </button>
          {expanded && (
            <div className="mt-3 space-y-3">
              {meeting.recording_url && (
                <a href={meeting.recording_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-secondary)] underline">
                  <Video className="h-3.5 w-3.5" />
                  Abrir gravação
                </a>
              )}
              {meeting.summary && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    <Sparkles className="h-3 w-3" /> Resumo gerado por IA
                  </div>
                  <p className="whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-sm text-[var(--color-text-primary)]">{meeting.summary}</p>
                </div>
              )}
              {meeting.transcript && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    <FileText className="h-3 w-3" /> Transcrição completa
                  </div>
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-xs text-[var(--color-text-secondary)]">{meeting.transcript}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  const { meetings, loading, reload, cancel } = useMeetings();
  const { departments } = useDepartments();
  const { userId, role } = useAppUser();
  const [showSchedule, setShowSchedule] = useState(false);
  const [query, setQuery] = useState('');

  const departmentName = useMemo(() => {
    const map = new Map(departments.map((d) => [d.id, d.name]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [departments]);

  const isAdmin = role === 'admin' || role === 'super_admin';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) =>
      m.title.toLowerCase().includes(q)
      || (m.description ?? '').toLowerCase().includes(q)
      || (m.summary ?? '').toLowerCase().includes(q)
      || (m.transcript ?? '').toLowerCase().includes(q));
  }, [meetings, query]);

  const handleCancel = async (id: string) => {
    const res = await cancel(id);
    if (!res.ok) toast.error('Falha ao cancelar', { description: res.error });
    else toast.success('Reunião cancelada.');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl glass-card">
            <Video className="h-5 w-5 text-[var(--accent-secondary)]" />
          </div>
          <div>
            <div className="text-label">Agenda</div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Reuniões</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Agende pelo Google Meet, com gravação, transcrição e resumo automáticos (quando configurado em Credenciais).
            </p>
          </div>
        </div>
        <Button type="button" onClick={() => setShowSchedule(true)}>
          <Plus className="h-4 w-4" />
          Nova reunião
        </Button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, resumo ou transcrição…"
          className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] py-2.5 pl-10 pr-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-secondary)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-2 py-16 text-center">
          <Video className="h-8 w-8 text-[var(--color-text-secondary)]" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {meetings.length === 0 ? 'Nenhuma reunião agendada ainda.' : 'Nenhuma reunião encontrada para essa busca.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              departmentName={departmentName(meeting.department_id)}
              canManage={isAdmin || meeting.created_by === userId}
              onCancel={(id) => void handleCancel(id)}
            />
          ))}
        </div>
      )}

      <ScheduleDialog open={showSchedule} onClose={() => setShowSchedule(false)} onScheduled={() => void reload()} />
    </div>
  );
}
