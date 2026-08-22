import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronLeft, ChevronRight, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog } from '@/components/ui/dialog';
import { useTags } from '@/hooks/useTags';
import { useDepartments, lineLabel } from '@/hooks/useDepartments';
import { useMassDispatches } from '@/hooks/useMassDispatches';
import { useDispatchFiles, dispatchFilePublicUrl } from '@/hooks/useDispatchFiles';
import { cn } from '@/lib/utils';
import type { DispatchAudienceFilter } from '@/types/massDispatch';

interface DispatchWizardProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type AudienceMode = 'all' | 'tags' | 'file';

interface MessageDraft {
  content: string;
  media_url: string | null;
  media_type: string | null;
}

const STEPS = ['Identidade', 'Audiência', 'Mensagens', 'Agendamento'] as const;
const MAX_MESSAGES = 5;

function emptyMessage(): MessageDraft {
  return { content: '', media_url: null, media_type: null };
}

export function DispatchWizard({ open, onClose, onSaved }: DispatchWizardProps) {
  const { tags } = useTags();
  const { lines } = useDepartments();
  const { createAndQueue, previewAudience } = useMassDispatches();
  const { files, uploadAttachment } = useDispatchFiles();

  const contactListFiles = useMemo(() => files.filter((f) => f.file_type === 'contact_list'), [files]);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('all');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [fileId, setFileId] = useState('');
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageDraft[]>([emptyMessage()]);
  const [minDelay, setMinDelay] = useState(30);
  const [maxDelay, setMaxDelay] = useState(90);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduleAt, setScheduleAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName('');
    setConnectionId('');
    setAudienceMode('all');
    setSelectedTagIds(new Set());
    setFileId('');
    setAudienceCount(null);
    setMessages([emptyMessage()]);
    setMinDelay(30);
    setMaxDelay(90);
    setScheduleNow(true);
    setScheduleAt('');
  }, [open]);

  const currentFilter: DispatchAudienceFilter = useMemo(() => {
    if (audienceMode === 'all') return { mode: 'all' };
    if (audienceMode === 'tags') return { mode: 'tags', tag_ids: Array.from(selectedTagIds) };
    if (audienceMode === 'file') return { mode: 'file', file_id: fileId };
    return { mode: 'all' };
  }, [audienceMode, selectedTagIds, fileId]);

  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(() => {
      previewAudience(currentFilter).then(setAudienceCount).catch((err) => {
        toast.error('Falha ao calcular audiência', { description: err instanceof Error ? err.message : String(err) });
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, audienceMode, selectedTagIds, fileId]);

  const scheduleInPast = !scheduleNow && !!scheduleAt && new Date(scheduleAt).getTime() <= Date.now();

  const validMessages = messages.filter((m) => m.content.trim());
  const canNext =
    (step === 0 && name.trim() && connectionId) ||
    (step === 1 && (audienceCount ?? 0) > 0 && (audienceMode !== 'file' || !!fileId) && (audienceMode !== 'tags' || selectedTagIds.size > 0)) ||
    (step === 2 && validMessages.length > 0 && minDelay >= 5 && maxDelay >= minDelay);

  const nextStep = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prevStep = () => setStep((s) => Math.max(0, s - 1));

  const addMessage = () => {
    if (messages.length >= MAX_MESSAGES) return;
    setMessages((cur) => [...cur, emptyMessage()]);
  };
  const removeMessage = (i: number) => setMessages((cur) => cur.filter((_, idx) => idx !== i));
  const updateMessage = (i: number, patch: Partial<MessageDraft>) =>
    setMessages((cur) => cur.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const handleAttach = async (i: number, file: File) => {
    setUploadingFor(i);
    try {
      const uploaded = await uploadAttachment(file, file.name);
      if (uploaded) {
        updateMessage(i, { media_url: dispatchFilePublicUrl(uploaded), media_type: uploaded.media_type });
        toast.success('Anexo enviado.');
      }
    } catch (err) {
      toast.error('Falha no upload', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setUploadingFor(null);
    }
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createAndQueue({
        name: name.trim(),
        connection_id: connectionId,
        audience_filter: currentFilter,
        messages: validMessages,
        min_delay_seconds: minDelay,
        max_delay_seconds: maxDelay,
        scheduled_at: scheduleNow ? null : new Date(scheduleAt).toISOString(),
      });
      if (result) {
        toast.success(`Disparo criado com ${result.queued} destinatário${result.queued === 1 ? '' : 's'}.`);
        onSaved?.();
        onClose();
      }
    } catch (err) {
      toast.error('Falha ao criar disparo', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Novo disparo em massa" widthClass="max-w-3xl">
      <ol className="grid grid-cols-4 gap-2 mb-6">
        {STEPS.map((label, idx) => {
          const state = idx < step ? 'done' : idx === step ? 'current' : 'pending';
          return (
            <li
              key={label}
              className={cn(
                'flex items-center gap-2 rounded-lg p-2 border text-xs font-semibold uppercase tracking-wide',
                state === 'current' && 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.08)] text-[var(--color-text-primary)]',
                state === 'done' && 'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.04)] text-[var(--color-text-secondary)]',
                state === 'pending' && 'border-[rgba(59,130,246,0.12)] text-[var(--color-text-secondary)] opacity-60',
              )}
            >
              <span
                className={cn(
                  'h-5 w-5 rounded-full flex items-center justify-center text-[10px]',
                  state === 'current' && 'bg-[var(--accent-primary)] text-white',
                  state === 'done' && 'bg-[var(--color-success)] text-white',
                  state === 'pending' && 'bg-white/5',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : idx + 1}
              </span>
              <span className="truncate">{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="d_name">Nome do disparo</Label>
            <Input id="d_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: promo-relancamento-setembro" disabled={submitting} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d_conn">Conexão (número que envia)</Label>
            {lines.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)] opacity-80">
                Nenhuma conexão WhatsApp cadastrada. Vá em Configurações → Departamentos para conectar um número.
              </p>
            ) : (
              <select
                id="d_conn"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                disabled={submitting}
                className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
              >
                <option value="">— selecione —</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{lineLabel(l)}</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] opacity-70">
            Envio por WhatsApp Web (Evolution), não pela Meta oficial — fora dos termos de uso do WhatsApp Business,
            mesmo risco de bloqueio de número que qualquer ferramenta de disparo automatizado. Use timing conservador
            e listas de contatos que já conhecem a empresa.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {(['all', 'tags', 'file'] as AudienceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAudienceMode(mode)}
                className={cn(
                  'p-3 rounded-lg border text-left text-sm font-medium transition-all',
                  audienceMode === mode
                    ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.08)] text-[var(--color-text-primary)]'
                    : 'border-[rgba(59,130,246,0.12)] bg-white/[0.02] text-[var(--color-text-secondary)]',
                )}
              >
                {mode === 'all' && 'Todos os contatos'}
                {mode === 'tags' && 'Por tags'}
                {mode === 'file' && 'Lista de arquivo'}
              </button>
            ))}
          </div>

          {audienceMode === 'tags' && (
            <div className="space-y-2">
              <Label>Tags (OR entre elas)</Label>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => {
                  const active = selectedTagIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setSelectedTagIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                      }
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs',
                        active ? 'bg-white/10 text-[var(--color-text-primary)]' : 'bg-white/[0.03] text-[var(--color-text-secondary)]',
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {audienceMode === 'file' && (
            <div className="space-y-2">
              <Label>Lista de contatos</Label>
              {contactListFiles.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)] opacity-80">
                  Nenhuma lista importada ainda. Vá na aba Arquivos para subir um CSV/XLSX de contatos.
                </p>
              ) : (
                <select
                  value={fileId}
                  onChange={(e) => setFileId(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
                >
                  <option value="">— selecione —</option>
                  {contactListFiles.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({(f.contact_ids ?? []).length} contatos)</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="rounded-lg border border-[rgba(59,130,246,0.15)] bg-[rgba(59,130,246,0.04)] p-4 text-center">
            <div className="text-label">Contatos alcançados</div>
            <div className="text-stat mt-1">{audienceCount ?? '…'}</div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Modelos de mensagem (até {MAX_MESSAGES}, sorteados aleatoriamente a cada envio)</Label>
              <Button type="button" variant="ghost" onClick={addMessage} disabled={messages.length >= MAX_MESSAGES}>
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
            {messages.map((m, i) => (
              <div key={i} className="rounded-lg border border-[rgba(59,130,246,0.15)] bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Modelo {i + 1}</span>
                  {messages.length > 1 && (
                    <button type="button" onClick={() => removeMessage(i)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <textarea
                  value={m.content}
                  onChange={(e) => updateMessage(i, { content: e.target.value })}
                  rows={3}
                  placeholder="Texto da mensagem…"
                  className="w-full resize-y rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
                />
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[rgba(59,130,246,0.2)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    {uploadingFor === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                    Anexar arquivo
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleAttach(i, f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {m.media_url && <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[240px]">{m.media_type} anexado</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="d_min">Intervalo mínimo (segundos)</Label>
              <Input id="d_min" type="number" min={5} value={minDelay} onChange={(e) => setMinDelay(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d_max">Intervalo máximo (segundos)</Label>
              <Input id="d_max" type="number" min={minDelay} value={maxDelay} onChange={(e) => setMaxDelay(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] opacity-70">
            Entre cada envio, o disparo espera um tempo aleatório dentro dessa faixa (mínimo real de 30s, ritmo do
            processador). Faixas maiores reduzem o risco de bloqueio, mas o disparo demora mais para terminar.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setScheduleNow(true)}
              className={cn('p-3 rounded-lg border text-left text-sm font-medium', scheduleNow ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.08)]' : 'border-[rgba(59,130,246,0.12)] bg-white/[0.02]')}
            >
              Disparar imediatamente
            </button>
            <button
              type="button"
              onClick={() => setScheduleNow(false)}
              className={cn('p-3 rounded-lg border text-left text-sm font-medium', !scheduleNow ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.08)]' : 'border-[rgba(59,130,246,0.12)] bg-white/[0.02]')}
            >
              Agendar para depois
            </button>
          </div>
          {!scheduleNow && (
            <div className="space-y-2">
              <Label htmlFor="d_when">Data e hora</Label>
              <Input id="d_when" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              {scheduleAt && scheduleInPast && (
                <p className="text-xs text-[#EF4444]">A data escolhida já passou — escolha um horário futuro.</p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-[rgba(59,130,246,0.1)] bg-white/[0.02] p-4 space-y-2 text-sm">
            <div className="text-label mb-1">Revisão</div>
            <div><span className="text-[var(--color-text-secondary)]">Disparo:</span> <span className="font-mono">{name}</span></div>
            <div><span className="text-[var(--color-text-secondary)]">Modelos de mensagem:</span> {validMessages.length}</div>
            <div><span className="text-[var(--color-text-secondary)]">Destinatários:</span> {audienceCount ?? 0}</div>
            <div><span className="text-[var(--color-text-secondary)]">Intervalo:</span> {minDelay}–{maxDelay}s</div>
            <div><span className="text-[var(--color-text-secondary)]">Quando:</span> {scheduleNow ? 'Imediato' : scheduleAt || '—'}</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-6 mt-4 border-t border-[rgba(59,130,246,0.08)]">
        <Button variant="ghost" onClick={prevStep} disabled={step === 0 || submitting}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={nextStep} disabled={!canNext || submitting}>
            Próximo <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={submitting || (!scheduleNow && (!scheduleAt || scheduleInPast))}>
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Criando...</>) : (<>Criar disparo</>)}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
