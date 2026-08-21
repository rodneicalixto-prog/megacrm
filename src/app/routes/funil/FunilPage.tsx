import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Clock, SquareKanban, Plus, Settings2, X } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { usePipeline } from '@/hooks/usePipeline';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { canSeeAdminNav } from '@/app/layout/nav-config';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { DealDrawer } from '@/components/funil/DealDrawer';
import { FunilManager } from '@/components/funil/FunilManager';
import { FunilFilter, applyDealFilter, EMPTY_FILTER, type DealFilter } from '@/components/funil/FunilFilter';
import { OriginBadge } from '@/components/origin/OriginBadge';
import { TEMPERATURE_STYLE, type ContactLite, type CustomField, type Deal, type Product, type Stage } from '@/types/crm';
import { dueBadge } from '@/lib/nextAction';

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Quantos cards mostrar por etapa antes do botão "carregar mais". Etapas com
// muitos negócios paravam de ser renderizadas inteiras a cada troca de filtro;
// isso é só paginação de exibição — os dados já estão carregados no client.
const STAGE_PAGE_SIZE = 20;

export default function FunilPage() {
  const funil = usePipeline();
  const { pipelines, selectedId, select, pipeline, stages, deals, loading, error, reload, moveDeal, createDeal } = funil;
  const { role } = useAppUser();

  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [productCatalog, setProductCatalog] = useState<Product[]>([]);
  const [filter, setFilter] = useState<DealFilter>(EMPTY_FILTER);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Quantos cards exibir por etapa (paginação client-side, "carregar mais").
  const [visibleByStage, setVisibleByStage] = useState<Record<string, number>>({});
  const showMore = (stageId: string) =>
    setVisibleByStage((cur) => ({ ...cur, [stageId]: (cur[stageId] ?? STAGE_PAGE_SIZE) + STAGE_PAGE_SIZE }));

  const filteredDeals = useMemo(() => applyDealFilter(deals, filter), [deals, filter]);

  const openDeal = useMemo(() => deals.find((d) => d.id === openDealId) ?? null, [deals, openDealId]);

  // Deep-link vindo da ficha do contato: ?deal=<uuid> abre o drawer quando o
  // deal estiver carregado no funil ativo.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const dealParam = searchParams.get('deal');
    if (dealParam && deals.some((d) => d.id === dealParam)) {
      setOpenDealId(dealParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals]);

  useEffect(() => {
    const supabase = getSupabase();
    void supabase
      .from('contacts')
      .select('id, name, phone')
      .order('name')
      .limit(500)
      .then(({ data }) => setContacts((data ?? []) as ContactLite[]));
    void supabase
      .from('custom_fields')
      .select('*')
      .order('position')
      .then(({ data }) => setCustomFields((data ?? []) as CustomField[]));
    void supabase
      .from('products')
      .select('id, name')
      .order('name')
      .then(({ data }) => setProductCatalog((data ?? []) as Product[]));
  }, []);

  const totalPipeline = useMemo(
    () => filteredDeals.reduce((s, d) => s + (Number(d.value) || 0), 0),
    [filteredDeals],
  );

  return (
    <div className="max-w-full space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
          <SquareKanban className="h-5 w-5 text-[var(--accent-primary)]" />
        </div>
        <div className="min-w-0">
          <div className="text-label">Seção</div>
          <h1 className="text-2xl font-bold text-display">Funil comercial</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {filteredDeals.length === deals.length
              ? `${deals.length} negócio(s)`
              : `${filteredDeals.length} de ${deals.length} negócio(s)`}{' '}
            · {brl(totalPipeline)} em pipeline · arraste entre as etapas
          </p>
        </div>

        {/* Filtro + seletor de funil + gestão */}
        <div className="ml-auto flex items-center gap-2">
          <FunilFilter deals={deals} customFields={customFields} productCatalog={productCatalog} value={filter} onChange={setFilter} />
          <div className="relative">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-[rgba(59,130,246,0.25)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] transition hover:border-[var(--accent-primary)]"
            >
              {pipeline?.name ?? 'Funil'}
              <ChevronDown className="h-4 w-4 opacity-70" />
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] p-1 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                  {pipelines.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { select(p.id); setPickerOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition hover:bg-white/5 ${
                        p.id === selectedId ? 'text-[var(--accent-secondary)]' : 'text-[var(--color-text-primary)]'
                      }`}
                    >
                      {p.name}
                      {p.is_default && <span className="text-[10px] text-[var(--color-text-secondary)]">padrão</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Sem gate de admin: qualquer papel operante pode criar/gerenciar o
              PRÓPRIO funil pessoal (RLS: owner_id = auth.uid()), sem limite de
              quantidade — só funil "da empresa" (owner_id NULL) é admin-only,
              e isso já é reforçado pela RLS + toast em FunilManager. Antes
              este botão era admin-only e escondia a função inteira de
              supervisor/operator, apesar da policy já permitir. */}
          <button
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[rgba(59,130,246,0.25)] px-3 py-2 text-sm text-[var(--accent-secondary)] transition hover:border-[var(--accent-primary)]"
          >
            <Settings2 className="h-4 w-4" /> Gerenciar funis
          </button>
          <div className="relative">
            <button
              onClick={() => setQuickAddOpen((v) => !v)}
              disabled={stages.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Negócio
            </button>
            {quickAddOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setQuickAddOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] p-3 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                  <AddDealForm
                    contacts={contacts}
                    stages={stages}
                    onCancel={() => setQuickAddOpen(false)}
                    onSubmit={async (input) => {
                      // stages foi passado, então o form sempre preenche stage_id.
                      await createDeal({ ...input, stage_id: input.stage_id ?? stages[0].id });
                      setQuickAddOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <LoadErrorBanner message={error} onRetry={() => void reload()} />}

      {loading ? (
        <div className="text-label opacity-60">Carregando funil...</div>
      ) : !pipeline ? (
        <div className="glass-card p-6 text-sm text-[var(--color-text-secondary)]">
          Nenhum funil comercial configurado.
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const list = filteredDeals.filter((d) => d.stage_id === stage.id);
            const total = list.reduce((s, d) => s + (Number(d.value) || 0), 0);
            const visible = visibleByStage[stage.id] ?? STAGE_PAGE_SIZE;
            const visibleList = list.slice(0, visible);
            const remaining = list.length - visibleList.length;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) void moveDeal(dragId, stage.id);
                  setDragId(null);
                }}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02]"
              >
                <div className="flex items-center justify-between border-b border-[rgba(59,130,246,0.1)] px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                    {stage.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />}
                    {stage.name}
                  </span>
                  <span className="text-xs text-[var(--color-text-secondary)]">{list.length}</span>
                </div>
                <div className="px-3 pt-1 text-xs text-[var(--color-text-secondary)]">{brl(total)}</div>

                <div className="flex-1 space-y-2 p-3">
                  {visibleList.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onDragStart={() => setDragId(deal.id)}
                      onOpen={() => setOpenDealId(deal.id)}
                    />
                  ))}

                  {remaining > 0 && (
                    <button
                      onClick={() => showMore(stage.id)}
                      className="w-full rounded-lg border border-[rgba(59,130,246,0.15)] py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                    >
                      Carregar mais ({remaining})
                    </button>
                  )}

                  {adding === stage.id ? (
                    <AddDealForm
                      contacts={contacts}
                      onCancel={() => setAdding(null)}
                      onSubmit={async (input) => {
                        await createDeal({ ...input, stage_id: stage.id });
                        setAdding(null);
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setAdding(stage.id)}
                      className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[rgba(59,130,246,0.25)] py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                    >
                      <Plus className="h-3 w-3" /> Negócio
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openDeal && (
        <DealDrawer
          deal={openDeal}
          stages={stages}
          pipelines={pipelines}
          isAdmin={canSeeAdminNav(role)}
          onClose={() => setOpenDealId(null)}
          onStageChange={moveDeal}
          onChanged={reload}
        />
      )}

      {manageOpen && (
        <FunilManager funil={funil} onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}

function DealCard({
  deal,
  onDragStart,
  onOpen,
}: {
  deal: Deal;
  onDragStart: () => void;
  onOpen: () => void;
}) {
  const draggedRef = useRef(false);
  const leadName = deal.contact?.name?.trim() || deal.contact?.phone || 'Sem nome';
  const temp = TEMPERATURE_STYLE[deal.temperature];

  return (
    <div
      draggable
      onDragStart={() => { draggedRef.current = true; onDragStart(); }}
      onDragEnd={() => { window.setTimeout(() => { draggedRef.current = false; }, 50); }}
      onClick={() => { if (!draggedRef.current) onOpen(); }}
      className="cursor-pointer p-3 transition hover:border-[rgba(59,130,246,0.45)] active:cursor-grabbing rounded-xl border border-[rgba(59,130,246,0.25)] shadow-[0_0_20px_rgba(59,130,246,0.06),inset_0_1px_0_rgba(59,130,246,0.1)]"
      style={{ background: '#0F1223' }}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Ajuste 3: nome do LEAD em destaque, negócio como subtítulo */}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{leadName}</div>
          <div className="truncate text-xs text-[var(--color-text-secondary)]">
            {deal.products && deal.products.length > 0
              ? `${deal.products[0].name}${deal.products.length > 1 ? ' e outros' : ''}`
              : deal.title}
          </div>
        </div>
        {temp && (
          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${temp.className}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${temp.dot}`} />
            {temp.label}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--accent-secondary)]">{brl(Number(deal.value) || 0)}</span>
        <div className="flex items-center gap-1">
          <OriginBadge deal={deal} />
          {deal.lead_type === 'Cliente' && (
            <span className="rounded-full bg-[rgba(16,185,129,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#10B981]">Cliente</span>
          )}
        </div>
      </div>
      {deal.tags && deal.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {deal.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{ background: `${t.color}22`, color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      {deal.next_action && (
        <div className="mt-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${dueBadge(deal.next_action.due_at).className}`}
          >
            <Clock className="h-2.5 w-2.5" />
            {dueBadge(deal.next_action.due_at).short}
          </span>
        </div>
      )}
    </div>
  );
}

function AddDealForm({
  contacts,
  stages,
  onSubmit,
  onCancel,
}: {
  contacts: ContactLite[];
  // Presente só no quick-add do topo (fora de uma coluna específica): quando
  // passado, o form mostra um seletor de etapa; dentro de uma coluna a etapa
  // já vem fixa (o caller injeta stage_id no onSubmit).
  stages?: Stage[];
  onSubmit: (input: { title: string; contact_id: string; value?: number; stage_id?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState(stages?.[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const inputCls =
    'w-full rounded-md border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-2 py-1 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]';

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || !contactId || (stages && !stageId)) return;
        setBusy(true);
        await onSubmit({ title: title.trim(), contact_id: contactId, value: Number(value) || 0, ...(stages ? { stage_id: stageId } : {}) });
        setBusy(false);
      }}
      className="space-y-2 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] p-2"
    >
      {stages && (
        <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls}>
        <option value="">Contato (lead)…</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>
        ))}
      </select>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do negócio" className={inputCls} />
      <input value={value} onChange={(e) => setValue(e.target.value)} type="number" step="0.01" placeholder="Valor (R$)" className={inputCls} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="flex-1 rounded-md bg-[var(--accent-primary)] px-2 py-1 text-xs font-semibold text-white disabled:opacity-60">
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-[rgba(59,130,246,0.2)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
          <X className="h-3 w-3" />
        </button>
      </div>
    </form>
  );
}

// Reexport para o Manager consumir o mesmo tipo de retorno do hook.
export type FunilController = ReturnType<typeof usePipeline>;
export type { Stage };
