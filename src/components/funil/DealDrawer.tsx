import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Building2, Mail, MessageSquare, Phone, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { useDealDetail } from '@/hooks/useDealDetail';
import { useOperators } from '@/hooks/useOperators';
import { useNextActions } from '@/hooks/useNextActions';
import { NextActions } from '@/components/crm/NextActions';
import { OriginBlock } from '@/components/origin/OriginBlock';
import {
  ChipEditor,
  CustomFieldInput,
  CustomFieldModal,
  dealInputClass,
  Field,
  InlineText,
  ProductsSubtitle,
} from './DealDrawerEditors';
import {
  CONTACT_SOURCE_LABEL,
  TEMPERATURE_STYLE,
  type Deal,
  type LeadType,
  type Pipeline,
  type Stage,
  type Temperature,
} from '@/types/crm';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isE164ish = (v: string) => /^\+?\d{8,15}$/.test(v.replace(/[\s()-]/g, ''));

interface DealDrawerProps {
  deal: Deal;
  stages: Stage[];
  pipelines: Pipeline[];
  isAdmin: boolean;
  onClose: () => void;
  onStageChange: (dealId: string, stageId: string) => void | Promise<void>;
  onChanged: () => void | Promise<void>;
}

export function DealDrawer({ deal, stages, pipelines, isAdmin, onClose, onStageChange, onChanged }: DealDrawerProps) {
  const detail = useDealDetail(deal);
  const { contact, fields, values, notes, products, tags, productCatalog, tagCatalog, loading, error } = detail;
  const { operators } = useOperators();
  const na = useNextActions({ dealId: deal.id, contactId: deal.contact_id });
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [fieldModal, setFieldModal] = useState(false);
  const [stageId, setStageId] = useState(deal.stage_id ?? '');
  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lostReason, setLostReason] = useState(deal.lost_reason ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => setStageId(deal.stage_id ?? ''), [deal.stage_id]);

  const company = contact?.custom_fields && typeof contact.custom_fields.company === 'string' ? String(contact.custom_fields.company) : null;

  const submitNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    await detail.addNote(note);
    setNote('');
    setSavingNote(false);
  };

  const changeStage = async (id: string) => {
    setStageId(id);
    await onStageChange(deal.id, id);
  };

  // Status manual do negócio (Módulo 3): won/lost preenchem won_at/lost_at via
  // trigger; perdido guarda o motivo. Reabrir volta para 'open' e limpa datas.
  // Marcar como ganho também move o card para a etapa "Ganho" (is_won) do
  // pipeline atual do lead — se o usuário excluiu essa etapa ou o pipeline
  // não tem uma, só muda o status (o card fica onde está).
  const markWon = () => {
    const wonStage = stages.find((s) => s.is_won);
    saveDealField(
      { status: 'won', ...(wonStage ? { stage_id: wonStage.id } : {}) },
      'Marcado como ganho. 🎉',
    );
    if (wonStage) setStageId(wonStage.id);
  };
  const markLost = () => {
    void saveDealField({ status: 'lost', lost_reason: lostReason.trim() || null }, 'Marcado como perdido.');
    setLostReasonOpen(false);
  };
  const reopen = () => {
    setLostReason('');
    void saveDealField({ status: 'open' }, 'Negócio reaberto.');
  };

  // Arquivar não muda status/etapa — só some do board padrão (FunilFilter
  // esconde archived_at != null a menos que "Mostrar arquivados" esteja ligado).
  const archive = () => void saveDealField({ archived_at: new Date().toISOString() }, 'Negócio arquivado.');
  const restore = () => void saveDealField({ archived_at: null }, 'Negócio restaurado.');

  const changePipeline = async (pipelineId: string) => {
    const supabase = getSupabase();
    const { data: st } = await supabase.from('stages').select('id').eq('pipeline_id', pipelineId).order('position').limit(1);
    const firstStage = (st?.[0] as { id: string } | undefined)?.id ?? null;
    const err = await detail.saveDeal({ pipeline_id: pipelineId, stage_id: firstStage });
    if (err) { toast.error(err); return; }
    toast.success('Lead movido de funil.');
    await onChanged();
    onClose();
  };

  const saveDealField = async (patch: Partial<Deal>, okMsg = 'Salvo.') => {
    const err = await detail.saveDeal(patch);
    if (err) toast.error(err);
    else { toast.success(okMsg); void onChanged(); }
  };

  const saveContactField = async (patch: Parameters<typeof detail.saveContact>[0]) => {
    const err = await detail.saveContact(patch);
    if (err) toast.error(err);
    else { toast.success('Salvo.'); void onChanged(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Detalhe do lead">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside
        className="relative z-10 flex h-full w-full max-w-full flex-col overflow-y-auto border-l border-[var(--color-border-card)] bg-[var(--color-bg-elevated)] shadow-[0_0_60px_rgba(59,130,246,0.12)] transition-transform duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] sm:w-[460px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[rgba(59,130,246,0.12)] bg-[var(--color-bg-elevated)]/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="text-label">Lead</div>
            {/* Título = nome do lead (contato), editável */}
            <InlineText
              value={contact?.name ?? ''}
              placeholder="Nome do lead"
              onSave={(v) => saveContactField({ name: v || null })}
              className="text-lg font-bold text-display"
            />
            {/* Subtítulo = produtos do negócio (multi-escolha do catálogo) */}
            <ProductsSubtitle
              products={products}
              catalog={productCatalog}
              fallback={deal.title}
              onToggle={async (p, selected) => {
                if (selected) await detail.removeProduct(p.id);
                else await detail.addProduct(p.name);
                void onChanged();
              }}
            />
          </div>
          <button onClick={onClose} aria-label="Fechar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-white/5 hover:text-[var(--color-text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-sm text-[#EF4444]">{error}</div>
        )}

        {loading && !contact ? (
          <div className="p-6 text-label opacity-60">Carregando ficha...</div>
        ) : (
          <div className="space-y-6 p-5">
            {/* Valor + temperatura + tipo */}
            <section className="grid grid-cols-2 gap-3">
              <Field label="Valor">
                <InlineText
                  value={String(deal.value ?? 0)}
                  type="number"
                  render={(v) => brl(Number(v) || 0)}
                  validate={(v) => (isNaN(Number(v)) ? 'Valor inválido.' : null)}
                  onSave={(v) => saveDealField({ value: Number(v) || 0 })}
                  className="text-sm font-semibold text-[var(--accent-secondary)]"
                />
              </Field>
              <Field label="Temperatura">
                <select
                  value={deal.temperature}
                  onChange={(e) => saveDealField({ temperature: e.target.value as Temperature }, 'Temperatura atualizada.')}
                  className={dealInputClass}
                >
                  {(Object.keys(TEMPERATURE_STYLE) as Temperature[]).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Tipo">
                <select value={deal.lead_type} onChange={(e) => saveDealField({ lead_type: e.target.value as LeadType }, 'Tipo atualizado.')} className={dealInputClass}>
                  <option value="Lead">Lead</option>
                  <option value="Cliente">Cliente</option>
                </select>
              </Field>
              <Field label="Última compra">
                <input
                  type="date"
                  defaultValue={deal.last_purchase_at ?? ''}
                  onChange={(e) => saveDealField({ last_purchase_at: e.target.value || null }, 'Data salva.')}
                  className={dealInputClass}
                />
              </Field>
            </section>

            {/* Arquivar / restaurar — some do board padrão, sem afetar status/etapa */}
            <section>
              {deal.archived_at ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.02] p-3 text-xs text-[var(--color-text-secondary)]">
                  <span>Arquivado em {fmtDate(deal.archived_at)}</span>
                  <button
                    onClick={restore}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(59,130,246,0.25)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-secondary)] transition hover:border-[var(--accent-primary)]"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" /> Restaurar
                  </button>
                </div>
              ) : (
                <button
                  onClick={archive}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(59,130,246,0.2)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]"
                >
                  <Archive className="h-3.5 w-3.5" /> Arquivar
                </button>
              )}
            </section>

            {/* Status do negócio (ganho / perdido) */}
            <section className="space-y-2">
              <div className="text-label">Status do negócio</div>
              {deal.status === 'open' ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={markWon}
                      className="flex-1 rounded-lg border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.1)] py-2 text-sm font-semibold text-[#10B981] transition hover:bg-[rgba(16,185,129,0.18)]"
                    >
                      Marcar como ganho
                    </button>
                    <button
                      onClick={() => setLostReasonOpen((v) => !v)}
                      className="flex-1 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] py-2 text-sm font-semibold text-[#EF4444] transition hover:bg-[rgba(239,68,68,0.16)]"
                    >
                      Marcar como perdido
                    </button>
                  </div>
                  {lostReasonOpen && (
                    <div className="space-y-2 rounded-lg border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] p-3">
                      <input
                        value={lostReason}
                        onChange={(e) => setLostReason(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && markLost()}
                        placeholder="Motivo da perda (opcional)"
                        className={dealInputClass}
                        autoFocus
                      />
                      <button
                        onClick={markLost}
                        className="w-full rounded-lg bg-[#EF4444] py-2 text-sm font-semibold text-white transition hover:opacity-90"
                      >
                        Confirmar perda
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={
                        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ' +
                        (deal.status === 'won'
                          ? 'bg-[rgba(16,185,129,0.14)] text-[#10B981]'
                          : 'bg-[rgba(239,68,68,0.14)] text-[#EF4444]')
                      }
                    >
                      {deal.status === 'won' ? 'Ganho' : 'Perdido'} ·{' '}
                      {fmtDate(deal.status === 'won' ? deal.won_at : deal.lost_at)}
                    </span>
                    <button
                      onClick={reopen}
                      className="text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      Reabrir
                    </button>
                  </div>
                  {deal.status === 'lost' && deal.lost_reason && (
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      Motivo: <span className="text-[var(--color-text-primary)]">{deal.lost_reason}</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Contato */}
            <section className="space-y-2">
              <div className="text-label">Contato</div>
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
                  <InlineText value={contact?.phone ?? ''} placeholder="Telefone" validate={(v) => (v && !isE164ish(v) ? 'Telefone inválido (use E.164).' : null)} onSave={(v) => saveContactField({ phone: v || null })} className="text-sm text-[var(--color-text-primary)]" />
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
                  <InlineText value={contact?.email ?? ''} placeholder="E-mail" validate={(v) => (v && !isEmail(v) ? 'E-mail inválido.' : null)} onSave={(v) => saveContactField({ email: v || null })} className="text-sm text-[var(--color-text-primary)]" />
                </div>
                {company && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <Building2 className="h-3.5 w-3.5" /> {company}
                  </div>
                )}
              </div>
            </section>

            {/* Origem rastreada (atribuição multi-camada) */}
            <OriginBlock deal={deal} />

            {/* Funil / etapa / responsável / origem */}
            <section className="grid grid-cols-2 gap-3">
              <Field label="Funil">
                <select value={deal.pipeline_id ?? ''} onChange={(e) => e.target.value && changePipeline(e.target.value)} className={dealInputClass}>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Etapa">
                <select value={stageId} onChange={(e) => void changeStage(e.target.value)} className={dealInputClass}>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Responsável">
                <select value={deal.owner_id ?? ''} onChange={(e) => saveDealField({ owner_id: e.target.value || null }, 'Responsável atualizado.')} className={dealInputClass}>
                  <option value="">Não atribuído</option>
                  {operators.map((o) => <option key={o.user_id} value={o.user_id}>{o.email}</option>)}
                </select>
              </Field>
              <Field label="Origem">
                <select value={contact?.source ?? ''} onChange={(e) => saveContactField({ source: e.target.value || null })} className={dealInputClass}>
                  <option value="">—</option>
                  {Object.entries(CONTACT_SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Criado em"><span className="text-sm text-[var(--color-text-primary)]">{fmtDate(deal.created_at)}</span></Field>
              <Field label="Última interação"><span className="text-sm text-[var(--color-text-primary)]">{fmtDate(deal.updated_at)}</span></Field>
            </section>

            <Link to={`/inbox?contact=${deal.contact_id}`} className="flex items-center justify-center gap-2 rounded-lg border border-[rgba(59,130,246,0.2)] py-2.5 text-sm font-medium text-[var(--accent-secondary)] transition hover:border-[var(--accent-primary)] hover:bg-white/5">
              <MessageSquare className="h-4 w-4" /> Abrir conversa no inbox
            </Link>

            {/* Tags */}
            <ChipEditor
              label="Tags"
              chips={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
              catalog={tagCatalog.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
              onAdd={detail.addTag}
              onRemove={detail.removeTag}
              colored
            />

            {/* Campos personalizados */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-label">Campos personalizados</div>
                {isAdmin && (
                  <button onClick={() => setFieldModal(true)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-secondary)] hover:text-[var(--accent-primary)]">
                    <Plus className="h-3 w-3" /> Novo campo
                  </button>
                )}
              </div>
              {fields.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)] opacity-70">Nenhum campo personalizado ainda.{isAdmin && ' Crie o primeiro em "Novo campo".'}</p>
              ) : (
                <div className="space-y-3">
                  {fields.map((f) => (
                    <CustomFieldInput key={f.id} field={f} value={values[f.id] ?? ''} onSave={(v) => detail.saveValue(f.id, v)} />
                  ))}
                </div>
              )}
            </section>

            {/* Próxima ação (follow-up manual) — refletir no badge do card via onChanged */}
            <NextActions
              fixedDealId={deal.id}
              actions={na.actions}
              onAdd={async (t, d, ty) => { await na.addAction({ text: t, dueAt: d, type: ty }); void onChanged(); }}
              onComplete={async (id) => { await na.completeAction(id); void onChanged(); }}
              onRemove={async (id) => { await na.removeAction(id); void onChanged(); }}
            />

            {/* Notas internas */}
            <section className="space-y-3">
              <div className="text-label">Notas internas</div>
              <div className="flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submitNote()} placeholder="Anotar algo sobre este lead…" className={dealInputClass} />
                <button onClick={submitNote} disabled={savingNote || !note.trim()} className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
                  {savingNote ? '…' : 'Anotar'}
                </button>
              </div>
              <ol className="space-y-2">
                {notes.length === 0 ? (
                  <li className="text-sm text-[var(--color-text-secondary)] opacity-70">Sem notas ainda.</li>
                ) : (
                  notes.map((n) => (
                    <li key={n.id} className="glass-card p-3">
                      <p className="whitespace-pre-wrap text-sm text-[var(--color-text-primary)]">{n.body ?? n.title}</p>
                      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">{fmtDate(n.created_at)}</div>
                    </li>
                  ))
                )}
              </ol>
            </section>
          </div>
        )}
      </aside>

      {fieldModal && (
        <CustomFieldModal onClose={() => setFieldModal(false)} onCreate={async (input) => { const created = await detail.createField(input); if (created) setFieldModal(false); }} />
      )}
    </div>
  );
}
