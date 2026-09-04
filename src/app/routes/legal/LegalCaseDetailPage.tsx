import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, Clock, Download, Loader2, Pause, Paperclip, Play, Plus,
  Scale, Send, Sparkles, Trash2, Upload, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLegalCaseDetail } from '@/hooks/useLegalCaseDetail';
import { useDepartments } from '@/hooks/useDepartments';
import { useOperators, operatorLabel } from '@/hooks/useOperators';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { dueBadge } from '@/lib/nextAction';
import type { LegalCaseSide } from '@/types/legal';

type Tab = 'overview' | 'tasks' | 'files' | 'chat' | 'briefing';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'tasks', label: 'Tarefas' },
  { key: 'files', label: 'Anexos' },
  { key: 'chat', label: 'Conversa' },
  { key: 'briefing', label: 'Contracapa (IA)' },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function fmtBytes(n: number | null) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LegalCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { userId } = useAppUser();
  const { departments } = useDepartments();
  const { operators } = useOperators();
  const detail = useLegalCaseDetail(caseId);
  const [tab, setTab] = useState<Tab>('overview');

  if (detail.loading || !detail.legalCase) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-secondary)]" />
      </div>
    );
  }

  const c = detail.legalCase;
  const departmentName = departments.find((d) => d.id === c.department_id)?.name ?? 'Setor não definido';
  const ownerLabel = operators.find((o) => o.user_id === c.owner_id);
  const badge = c.next_deadline_at ? dueBadge(c.next_deadline_at) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <Link to="/juridico" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--accent-secondary)]">
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar aos processos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {c.case_number && <span className="text-xs text-[var(--color-text-secondary)]">Nº {c.case_number}</span>}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{c.title}</h1>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              {departmentName}
            </span>
          </div>
        </div>
      </header>

      {badge && c.next_deadline_label && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${badge.className}`}>
          <Clock className="h-4 w-4 shrink-0" />
          <span>{c.next_deadline_label} — {badge.full}</span>
        </div>
      )}

      <div className="flex gap-5 overflow-x-auto border-b border-[rgba(59,130,246,0.1)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 pb-2.5 text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab detail={detail} departmentName={departmentName} ownerLabel={ownerLabel ? operatorLabel(ownerLabel) : null} />}
      {tab === 'tasks' && <TasksTab detail={detail} operators={operators} />}
      {tab === 'files' && <FilesTab detail={detail} />}
      {tab === 'chat' && <ChatTab detail={detail} userId={userId} />}
      {tab === 'briefing' && <BriefingTab detail={detail} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function OverviewTab({ detail, departmentName, ownerLabel }: { detail: ReturnType<typeof useLegalCaseDetail>; departmentName: string; ownerLabel: string | null }) {
  const c = detail.legalCase!;
  const [witnessOpen, setWitnessOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="glass-card p-5">
          <h3 className="text-label mb-3">Dados do processo</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Setor" value={departmentName} />
            <Row label="Advogado externo" value={c.external_counsel ?? '—'} />
            <Row label="Parte contrária" value={c.opposing_party ?? '—'} />
            <Row label="Vara / tribunal" value={c.court_reference ?? '—'} />
          </dl>
        </div>
        <div className="glass-card p-5">
          <h3 className="text-label mb-3">Quem acompanha</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Responsável interno" value={ownerLabel ?? '—'} />
            {detail.participants.map((p) => (
              <Row key={p.id} label={p.role_label} value={p.external_name ?? p.user_id ?? '—'} />
            ))}
          </dl>
        </div>
      </div>

      {c.summary && (
        <div className="glass-card p-5">
          <h3 className="text-label mb-3">Resumo</h3>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{c.summary}</p>
        </div>
      )}

      <div className="glass-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-label">Testemunhas &amp; prepostos</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setWitnessOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        </div>
        {detail.witnesses.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma testemunha ou preposto cadastrado ainda.</p>
        ) : (
          <div className="space-y-2">
            {detail.witnesses.map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${w.side === 'empresa' ? 'bg-[rgba(16,185,129,0.14)] text-[#10B981]' : 'bg-white/5 text-[var(--color-text-secondary)]'}`}>
                  {w.side === 'empresa' ? 'Empresa' : 'Reclamante'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{w.name}</div>
                  <div className="truncate text-xs text-[var(--color-text-secondary)]">{w.role_label} · {w.status}</div>
                </div>
                <button type="button" onClick={() => void detail.removeWitness(w.id)} className="text-[var(--color-text-secondary)] hover:text-[#EF4444]">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail.movements.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-label mb-3">Andamentos do tribunal</h3>
          <div className="space-y-3">
            {detail.movements.map((m) => (
              <div key={m.id} className="border-l-2 border-[rgba(59,130,246,0.25)] pl-3 text-sm">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">{fmtDate(m.occurred_at)}</div>
                <div className="text-[var(--color-text-primary)]">{m.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <WitnessDialog open={witnessOpen} onClose={() => setWitnessOpen(false)} onAdd={detail.addWitness} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[rgba(59,130,246,0.06)] pt-2 first:border-none first:pt-0">
      <dt className="text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="text-right font-semibold text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}

function WitnessDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string, role: string, side: LegalCaseSide) => Promise<{ ok: boolean; error?: string }> }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [side, setSide] = useState<LegalCaseSide>('empresa');
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    if (!name.trim()) { toast.error('Informe o nome.'); return; }
    setSaving(true);
    try {
      const res = await onAdd(name.trim(), role.trim() || 'Testemunha', side);
      if (!res.ok) { toast.error('Falha ao adicionar', { description: res.error }); return; }
      setName(''); setRole(''); setSide('empresa');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm glass-card p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-display">Adicionar testemunha ou preposto</h2>
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome"
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Papel (ex.: Preposto, Testemunha — cargo)"
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          <select value={side} onChange={(e) => setSide(e.target.value as LegalCaseSide)}
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]">
            <option value="empresa">Lado da empresa</option>
            <option value="reclamante">Lado do reclamante</option>
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>Adicionar</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TasksTab({ detail, operators }: { detail: ReturnType<typeof useLegalCaseDetail>; operators: ReturnType<typeof useOperators>['operators'] }) {
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newChecklistText, setNewChecklistText] = useState<Record<string, string>>({});

  const submitTask = async () => {
    if (!newTitle.trim()) { toast.error('Informe o título da tarefa.'); return; }
    const res = await detail.addTask(newTitle.trim(), newDue ? new Date(newDue).toISOString() : null, newOwner || null);
    if (!res.ok) { toast.error('Falha ao criar tarefa', { description: res.error }); return; }
    setNewTitle(''); setNewDue(''); setNewOwner('');
  };

  return (
    <div className="space-y-4">
      <div className="glass-card space-y-3 p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Nova tarefa…"
            className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          <input type="datetime-local" value={newDue} onChange={(e) => setNewDue(e.target.value)}
            className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)}
            className="rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]">
            <option value="">Sem responsável</option>
            {operators.map((o) => <option key={o.user_id} value={o.user_id}>{operatorLabel(o)}</option>)}
          </select>
          <Button type="button" onClick={() => void submitTask()}><Plus className="h-4 w-4" />Tarefa</Button>
        </div>
      </div>

      {detail.tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">Nenhuma tarefa cadastrada ainda.</p>
      ) : (
        <div className="space-y-3">
          {detail.tasks.map((t) => {
            const checklist = detail.checklistByTask[t.id] ?? [];
            const done = checklist.filter((i) => i.done).length;
            const badge = !t.done && t.due_at ? dueBadge(t.due_at) : null;
            return (
              <div key={t.id} className="glass-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void detail.toggleTaskDone(t.id, !t.done)}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${t.done ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white' : 'border-[rgba(59,130,246,0.3)]'}`}
                    >
                      {t.done && <Check className="h-3 w-3" />}
                    </button>
                    <div>
                      <p className={`text-sm font-semibold ${t.done ? 'text-[var(--color-text-secondary)] line-through' : 'text-[var(--color-text-primary)]'}`}>{t.title}</p>
                      {t.due_at && <p className="text-xs text-[var(--color-text-secondary)]">{fmtDate(t.due_at)}</p>}
                    </div>
                  </div>
                  {badge && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}>{badge.short}</span>
                  )}
                </div>

                {checklist.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-[rgba(59,130,246,0.08)] pt-3">
                    {checklist.map((item) => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={item.done} onChange={(e) => void detail.toggleChecklistItem(item.id, e.target.checked)} className="accent-[var(--accent-primary)]" />
                        <span className={item.done ? 'text-[var(--color-text-secondary)] line-through' : 'text-[var(--color-text-primary)]'}>{item.label}</span>
                      </label>
                    ))}
                    <span className="text-[10.5px] font-semibold text-[var(--color-text-secondary)]">{done}/{checklist.length} itens</span>
                  </div>
                )}

                <div className="mt-2 flex gap-2">
                  <input
                    value={newChecklistText[t.id] ?? ''}
                    onChange={(e) => setNewChecklistText((s) => ({ ...s, [t.id]: e.target.value }))}
                    placeholder="Novo item do checklist…"
                    className="flex-1 rounded-lg border border-[rgba(59,130,246,0.15)] bg-white/[0.03] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const label = (newChecklistText[t.id] ?? '').trim();
                      if (!label) return;
                      await detail.addChecklistItem(t.id, label, checklist.length);
                      setNewChecklistText((s) => ({ ...s, [t.id]: '' }));
                    }}
                    className="rounded-lg border border-[rgba(59,130,246,0.2)] px-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function FilesTab({ detail }: { detail: ReturnType<typeof useLegalCaseDetail> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const res = await detail.uploadAttachment(file);
        if (!res.ok) toast.error(`Falha ao enviar ${file.name}`, { description: res.error });
      }
      toast.success('Upload concluído.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDownload = async (storagePath: string, fileName: string) => {
    const res = await detail.getAttachmentUrl(storagePath);
    if (!res.ok) { toast.error('Falha ao gerar link', { description: res.error }); return; }
    const a = document.createElement('a');
    a.href = res.url;
    a.download = fileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  return (
    <div className="space-y-4">
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-[rgba(59,130,246,0.3)] py-8 text-center text-[var(--color-text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]"
      >
        {uploading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-primary)]" /> : <Upload className="h-6 w-6 text-[var(--accent-primary)]" />}
        <div className="text-sm"><b>Clique para enviar</b> ou arraste arquivos aqui</div>
        <div className="text-xs">Até 25MB por arquivo — bucket privado, só acessível a quem tem acesso ao Jurídico</div>
      </button>

      {detail.attachments.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">Nenhum anexo ainda.</p>
      ) : (
        <div className="space-y-2">
          {detail.attachments.map((f) => (
            <div key={f.id} className="glass-card flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--accent-secondary)]">
                <Paperclip className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{f.file_name}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">{fmtBytes(f.size_bytes)} · {fmtDate(f.created_at)}</div>
              </div>
              <button type="button" onClick={() => void handleDownload(f.storage_path, f.file_name)} className="text-[var(--color-text-secondary)] hover:text-[var(--accent-secondary)]">
                <Download className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => void detail.deleteAttachment(f)} className="text-[var(--color-text-secondary)] hover:text-[#EF4444]">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-white/[0.03] p-3 text-xs text-[var(--color-text-secondary)]">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span><b>Próxima fase:</b> resumo automático dos anexos por IA — não incluído ainda.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ChatTab({ detail, userId }: { detail: ReturnType<typeof useLegalCaseDetail>; userId: string | null }) {
  const [text, setText] = useState('');
  const paused = Boolean(detail.legalCase?.chat_paused_at);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [detail.messages.length]);

  const submit = async () => {
    if (!text.trim() || !userId) return;
    const res = await detail.sendMessage(text.trim(), userId);
    if (!res.ok) { toast.error('Falha ao enviar mensagem', { description: res.error }); return; }
    setText('');
  };

  return (
    <div className="glass-card flex h-[480px] flex-col">
      <div className="flex items-center justify-between border-b border-[rgba(59,130,246,0.08)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
          <Users className="h-4 w-4 text-[var(--accent-secondary)]" />
          Conversa fechada deste processo
        </div>
        <button
          type="button"
          onClick={() => void detail.setChatPaused(!paused)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]"
          title={paused ? 'Retomar conversa' : 'Pausar conversa'}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {detail.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">Sem mensagens ainda — comece a conversa deste processo.</p>
        ) : (
          detail.messages.map((m) => (
            <div key={m.id} className="max-w-[85%]">
              <div className="rounded-2xl rounded-tl-sm bg-white/5 px-3 py-2 text-sm text-[var(--color-text-primary)]">{m.content}</div>
              <div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{fmtDate(m.created_at)}</div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <p className="flex items-center gap-1.5 px-4 pb-1 text-[10.5px] text-[var(--color-text-secondary)]">
        Visível só para quem tem acesso ao Jurídico — arquivada aqui junto do processo.
      </p>
      <div className="flex items-center gap-2 border-t border-[rgba(59,130,246,0.08)] p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          disabled={paused}
          placeholder={paused ? 'Conversa pausada — retome para escrever' : 'Escrever na conversa do processo…'}
          className="flex-1 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50"
        />
        <Button type="button" size="icon" disabled={paused} onClick={() => void submit()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function BriefingTab({ detail }: { detail: ReturnType<typeof useLegalCaseDetail> }) {
  const [note, setNote] = useState('');
  const [trigger, setTrigger] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = detail.briefings[0];

  const submit = async () => {
    if (!note.trim()) { toast.error('Escreva o texto da nova versão.'); return; }
    setSaving(true);
    try {
      const res = await detail.appendBriefing(note.trim(), trigger.trim() || 'Nota manual');
      if (!res.ok) { toast.error('Falha ao registrar', { description: res.error }); return; }
      setNote(''); setTrigger('');
      toast.success('Nova versão da contracapa registrada.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.08)] p-3 text-xs text-[var(--color-text-secondary)]">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8B5CF6]" />
        <span>
          <b className="text-[var(--color-text-primary)]">Contracapa deste processo</b> — histórico versionado, nunca sobrescrito. Geração automática pela IA
          (a partir de anexos e conversa) é a próxima fase; por ora, registre manualmente.
        </span>
      </div>

      {latest ? (
        <div className="glass-card p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-label">Versão atual (v{latest.version})</span>
            <span className="text-[10.5px] text-[var(--color-text-secondary)]">{fmtDate(latest.created_at)}</span>
          </div>
          {latest.classification && (
            <span className="mb-2 inline-block rounded-full bg-[rgba(139,92,246,0.12)] px-2.5 py-0.5 text-[11px] font-semibold text-[#8B5CF6]">
              {latest.classification}
            </span>
          )}
          <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">{latest.summary_text}</p>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">Nenhuma versão registrada ainda.</p>
      )}

      <div className="glass-card space-y-3 p-4">
        <h3 className="text-label">Registrar nova versão</h3>
        <input
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          placeholder="O que motivou (ex.: sentença publicada, novo anexo)"
          className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="Texto da nova versão da contracapa…"
          className="w-full resize-none rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
        />
        <div className="flex justify-end">
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
            Registrar versão
          </Button>
        </div>
      </div>

      {detail.briefings.length > 1 && (
        <div className="glass-card p-5">
          <h3 className="text-label mb-3">Linha do tempo do briefing</h3>
          <div className="space-y-3">
            {detail.briefings.map((b) => (
              <div key={b.id} className="border-l-2 border-[rgba(139,92,246,0.3)] pl-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#8B5CF6]">v{b.version} · {b.trigger_label ?? b.trigger_type} · {fmtDate(b.created_at)}</div>
                <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{b.summary_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
