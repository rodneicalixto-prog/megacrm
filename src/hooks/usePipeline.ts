import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { chunkArray } from '@/lib/chunk';
import type { ActionType, Pipeline, PipelineKind, Stage, Deal, Tag } from '@/types/crm';

const IN_FILTER_CHUNK_SIZE = 100;

const DEAL_SELECT =
  '*, contact:contact_id(id, name, phone, email, conversations(channel)), deal_tags(tag:tag_id(id, name, color)), deal_products(product:product_id(id, name)), custom_field_values(custom_field_id, value)';

// Normaliza os deal_tags aninhados do PostgREST em Deal.tags.
function normalizeDeal(row: Record<string, unknown>): Deal {
  const dt = (row.deal_tags as Array<{ tag: Tag | null }> | undefined) ?? [];
  const tags = dt.map((x) => x.tag).filter((t): t is Tag => Boolean(t));
  const dp = (row.deal_products as Array<{ product: { id: string; name: string } | null }> | undefined) ?? [];
  const products = dp.map((x) => x.product).filter((p): p is { id: string; name: string } => Boolean(p));
  const cfv = (row.custom_field_values as Array<{ custom_field_id: string; value: string | null }> | undefined) ?? [];
  const field_values: Record<string, string> = {};
  for (const v of cfv) field_values[v.custom_field_id] = v.value ?? '';
  // Canal de mensageria (WhatsApp/Instagram/Evolution) vem da conversa do contato.
  // conversations.contact_id é UNIQUE, então o PostgREST embute o recurso como
  // relação 1-para-1 → devolve um OBJETO (não array). Tratamos os dois casos.
  const contactObj = row.contact as {
    conversations?: { channel: string | null } | Array<{ channel: string | null }> | null;
  } | null;
  const convEmbed = contactObj?.conversations;
  const channel = Array.isArray(convEmbed)
    ? convEmbed[0]?.channel ?? null
    : convEmbed?.channel ?? null;
  if (contactObj && 'conversations' in contactObj) delete (contactObj as Record<string, unknown>).conversations;
  const { deal_tags: _omit, deal_products: _omit2, custom_field_values: _omit3, ...rest } = row;
  return { ...(rest as unknown as Deal), tags, products, field_values, channel };
}

interface CreateDealInput {
  title: string;
  contact_id: string;
  value?: number;
  stage_id: string;
}

interface UsePipelineResult {
  pipelines: Pipeline[];
  selectedId: string | null;
  select: (id: string) => void;
  pipeline: Pipeline | null;
  stages: Stage[];
  deals: Deal[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  moveDeal: (dealId: string, stageId: string) => Promise<void>;
  createDeal: (input: CreateDealInput) => Promise<void>;
  // Ações em massa — usadas pela toolbar de seleção múltipla do FunilPage.
  bulkMoveStage: (dealIds: string[], stageId: string) => Promise<{ ok: boolean; error?: string }>;
  bulkAssignOwner: (dealIds: string[], ownerId: string | null) => Promise<{ ok: boolean; error?: string }>;
  bulkAddTag: (dealIds: string[], tagId: string) => Promise<{ ok: boolean; error?: string }>;
  // Gestão de funis
  // scope 'pessoal' = só do usuário; 'empresa' = compartilhado (owner_id nulo),
  // que a RLS reserva a admin. kind decide o propósito do funil e os
  // estágios padrão semeados (comercial = ganho/perdido tocam Vendas &
  // Recompra; atendimento = fluxo de status sem relação com receita).
  createPipeline: (name: string, scope?: 'pessoal' | 'empresa', kind?: PipelineKind) => Promise<Pipeline | null>;
  renamePipeline: (id: string, name: string) => Promise<void>;
  deletePipeline: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setDefaultPipeline: (id: string) => Promise<void>;
  // Editor de estágios
  addStage: (name: string) => Promise<void>;
  renameStage: (id: string, name: string) => Promise<void>;
  setStageColor: (id: string, color: string | null) => Promise<void>;
  setStageProbability: (id: string, probability: number) => Promise<void>;
  setStageAiCriteria: (id: string, criteria: string | null) => Promise<void>;
  reorderStages: (orderedIds: string[]) => Promise<void>;
  removeStage: (id: string, moveToStageId: string) => Promise<{ ok: boolean; error?: string }>;
}

export function usePipeline(): UsePipelineResult {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedId) ?? null,
    [pipelines, selectedId],
  );

  // Carrega a lista de funis comerciais. Mantém a seleção atual se ainda existir,
  // senão cai no default (ou no primeiro).
  const loadPipelines = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from('pipelines')
      .select('*')
      .eq('kind', 'comercial')
      .order('position');
    if (err) {
      setError(err.message);
      return [] as Pipeline[];
    }
    const list = (data ?? []) as Pipeline[];
    setPipelines(list);
    setSelectedId((cur) => {
      if (cur && list.some((p) => p.id === cur)) return cur;
      return (list.find((p) => p.is_default) ?? list[0])?.id ?? null;
    });
    return list;
  }, []);

  // Carrega estágios + deals do funil selecionado.
  const loadBoard = useCallback(async (pipelineId: string | null) => {
    if (!pipelineId) {
      setStages([]);
      setDeals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = getSupabase();
    const [{ data: st }, { data: dl, error: dErr }] = await Promise.all([
      supabase.from('stages').select('*').eq('pipeline_id', pipelineId).order('position'),
      supabase.from('deals').select(DEAL_SELECT).eq('pipeline_id', pipelineId).order('created_at', { ascending: false }),
    ]);
    if (dErr) setError(dErr.message);
    setStages((st ?? []) as Stage[]);
    const dealRows = ((dl ?? []) as Record<string, unknown>[]).map(normalizeDeal);

    // Próxima ação pendente por deal (para o badge do card): a mais próxima de
    // cada negócio. Uma query só, reduzida ao 1º por deal_id (ordem por due_at).
    const dealIds = dealRows.map((d) => d.id);
    if (dealIds.length) {
      // dealIds escala com o número de negócios do funil — fatiamos em lotes
      // de 100 para não estourar o `.in()`. Cada deal_id cai numa única fatia,
      // então o "1º por deal_id" (mais próximo) continua correto por fatia.
      const chunks = chunkArray(dealIds, IN_FILTER_CHUNK_SIZE);
      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from('crm_activities')
            .select('deal_id, due_at, type, id')
            .in('deal_id', chunk)
            .not('due_at', 'is', null)
            .eq('done', false)
            .order('due_at', { ascending: true }),
        ),
      );
      const acts = results.flatMap((r) => r.data ?? []);
      const soonest = new Map<string, { id: string; due_at: string; type: ActionType }>();
      for (const a of acts as Array<{ deal_id: string; due_at: string; type: string; id: string }>) {
        if (!soonest.has(a.deal_id)) {
          soonest.set(a.deal_id, { id: a.id, due_at: a.due_at, type: a.type as ActionType });
        }
      }
      for (const d of dealRows) d.next_action = soonest.get(d.id) ?? null;
    }
    setDeals(dealRows);
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    const list = await loadPipelines();
    const target = (list.find((p) => p.id === selectedId) ?? list.find((p) => p.is_default) ?? list[0])?.id ?? null;
    await loadBoard(target);
  }, [loadPipelines, loadBoard, selectedId]);

  useEffect(() => {
    void loadPipelines().then((list) => {
      const target = (list.find((p) => p.is_default) ?? list[0])?.id ?? null;
      void loadBoard(target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao trocar de funil no seletor, recarrega o board.
  useEffect(() => {
    if (selectedId) void loadBoard(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const select = useCallback((id: string) => setSelectedId(id), []);

  // Realtime dos deals do funil ativo.
  useEffect(() => {
    if (!selectedId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`pipeline-${selectedId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'whatsapp_hub', table: 'deals' }, (payload) => {
        setDeals((cur) => {
          if (payload.eventType === 'DELETE') return cur.filter((d) => d.id !== (payload.old as Deal).id);
          const row = payload.new as Deal;
          if (row.pipeline_id !== selectedId) return cur.filter((d) => d.id !== row.id);
          const idx = cur.findIndex((d) => d.id === row.id);
          if (idx === -1) return [{ ...row, tags: [] }, ...cur];
          const next = [...cur];
          next[idx] = { ...next[idx], ...row };
          return next;
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const moveDeal = useCallback(
    async (dealId: string, stageId: string) => {
      const prevStageId = deals.find((d) => d.id === dealId)?.stage_id ?? null;
      setDeals((cur) => cur.map((d) => (d.id === dealId ? { ...d, stage_id: stageId } : d)));
      const stage = stages.find((s) => s.id === stageId);
      const patch: Partial<Deal> = { stage_id: stageId };
      if (stage?.is_won) patch.status = 'won';
      else if (stage?.is_lost) patch.status = 'lost';
      else patch.status = 'open';
      const supabase = getSupabase();
      const { error: err } = await supabase.from('deals').update(patch).eq('id', dealId);
      if (err) {
        setError(err.message);
        return;
      }
      // Registra a movimentação manual no histórico (Módulo 8: moved_by='humano').
      if (prevStageId !== stageId) {
        const { data: u } = await supabase.auth.getUser();
        await supabase.from('lead_stage_history').insert({
          deal_id: dealId,
          from_stage_id: prevStageId,
          to_stage_id: stageId,
          moved_by: 'humano',
          actor_id: u?.user?.id ?? null,
        });
      }
    },
    [stages, deals],
  );

  const createDeal = useCallback<UsePipelineResult['createDeal']>(
    async (input) => {
      if (!selectedId) return;
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from('deals')
        .insert({
          title: input.title,
          contact_id: input.contact_id,
          value: input.value ?? 0,
          pipeline_id: selectedId,
          stage_id: input.stage_id,
          status: 'open',
        })
        .select(DEAL_SELECT)
        .single();
      if (err) {
        setError(err.message);
        return;
      }
      const deal = normalizeDeal(data as Record<string, unknown>);
      setDeals((cur) => (cur.some((d) => d.id === deal.id) ? cur : [deal, ...cur]));
    },
    [selectedId],
  );

  // ---- Gestão de funis ------------------------------------------------------
  const createPipeline = useCallback<UsePipelineResult['createPipeline']>(async (name, scope = 'pessoal', kind = 'comercial') => {
    const supabase = getSupabase();
    const nextPos = pipelines.reduce((m, p) => Math.max(m, p.position), -1) + 1;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    if (scope === 'pessoal' && !uid) {
      setError('Sessão expirada — entre novamente para criar um funil.');
      return null;
    }
    const { data, error: err } = await supabase
      .from('pipelines')
      .insert({
        name: name.trim(),
        kind,
        position: nextPos,
        is_default: false,
        // owner_id nulo é o funil da empresa; a RLS só deixa admin criar assim.
        owner_id: scope === 'empresa' ? null : uid,
      })
      .select('*')
      .single();
    if (err) {
      setError(err.message);
      return null;
    }
    const pipe = data as Pipeline;
    // Semeia estágios padrão para o funil não nascer vazio. Comercial ganha o
    // fluxo de vendas (ganho/perdido tocam Vendas & Recompra); atendimento
    // ganha um fluxo de status sem noção de "perdido".
    const defaultStages = kind === 'atendimento'
      ? [
          { pipeline_id: pipe.id, name: 'Aberto', position: 0, is_won: false, is_lost: false, probability: 0 },
          { pipeline_id: pipe.id, name: 'Em atendimento', position: 1, is_won: false, is_lost: false, probability: 50 },
          { pipeline_id: pipe.id, name: 'Resolvido', position: 2, is_won: true, is_lost: false, probability: 100 },
        ]
      : [
          { pipeline_id: pipe.id, name: 'Novo lead', position: 0, is_won: false, is_lost: false, probability: 10 },
          { pipeline_id: pipe.id, name: 'Em andamento', position: 1, is_won: false, is_lost: false, probability: 50 },
          { pipeline_id: pipe.id, name: 'Ganho', position: 2, is_won: true, is_lost: false, probability: 100 },
          { pipeline_id: pipe.id, name: 'Perdido', position: 3, is_won: false, is_lost: true, probability: 0 },
        ];
    await supabase.from('stages').insert(defaultStages);
    await loadPipelines();
    setSelectedId(pipe.id);
    return pipe;
  }, [pipelines, loadPipelines]);

  const renamePipeline = useCallback(async (id: string, name: string) => {
    const supabase = getSupabase();
    setPipelines((cur) => cur.map((p) => (p.id === id ? { ...p, name } : p)));
    const { error: err } = await supabase.from('pipelines').update({ name: name.trim() }).eq('id', id);
    if (err) setError(err.message);
  }, []);

  const deletePipeline = useCallback<UsePipelineResult['deletePipeline']>(
    async (id) => {
      // Sem piso de "um funil": com funis pessoais, o último funil de alguém é
      // dele, e proibir apagá-lo prendia a pessoa a um funil que ela não quer.
      const supabase = getSupabase();
      const { count, error: countErr } = await supabase
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('pipeline_id', id);
      if (countErr) {
        console.error('[usePipeline] falha ao checar negócios do funil antes de excluir', countErr);
        return { ok: false, error: 'Não foi possível confirmar se o funil está vazio. Tente novamente.' };
      }
      if ((count ?? 0) > 0) {
        return { ok: false, error: 'Este funil tem negócios. Mova-os para outro funil antes de excluir.' };
      }
      const { error: err } = await supabase.from('pipelines').delete().eq('id', id);
      if (err) return { ok: false, error: err.message };
      if (selectedId === id) setSelectedId(null);
      await loadPipelines();
      return { ok: true };
    },
    [selectedId, loadPipelines],
  );

  const setDefaultPipeline = useCallback(async (id: string) => {
    const supabase = getSupabase();
    setPipelines((cur) => cur.map((p) => ({ ...p, is_default: p.id === id })));
    await supabase.from('pipelines').update({ is_default: false }).neq('id', id);
    await supabase.from('pipelines').update({ is_default: true }).eq('id', id);
  }, []);

  // ---- Editor de estágios ---------------------------------------------------
  const addStage = useCallback(async (name: string) => {
    if (!selectedId) return;
    const supabase = getSupabase();
    const nextPos = stages.reduce((m, s) => Math.max(m, s.position), -1) + 1;
    const { data, error: err } = await supabase
      .from('stages')
      .insert({ pipeline_id: selectedId, name: name.trim(), position: nextPos, is_won: false, is_lost: false, probability: 50 })
      .select('*')
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    setStages((cur) => [...cur, data as Stage]);
  }, [selectedId, stages]);

  const renameStage = useCallback(async (id: string, name: string) => {
    const supabase = getSupabase();
    setStages((cur) => cur.map((s) => (s.id === id ? { ...s, name } : s)));
    const { error: err } = await supabase.from('stages').update({ name: name.trim() }).eq('id', id);
    if (err) setError(err.message);
  }, []);

  const setStageColor = useCallback(async (id: string, color: string | null) => {
    const supabase = getSupabase();
    setStages((cur) => cur.map((s) => (s.id === id ? { ...s, color } : s)));
    const { error: err } = await supabase.from('stages').update({ color }).eq('id', id);
    if (err) setError(err.message);
  }, []);

  const setStageProbability = useCallback(async (id: string, probability: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(probability)));
    const supabase = getSupabase();
    setStages((cur) => cur.map((s) => (s.id === id ? { ...s, probability: clamped } : s)));
    const { error: err } = await supabase.from('stages').update({ probability: clamped }).eq('id', id);
    if (err) setError(err.message);
  }, []);

  const setStageAiCriteria = useCallback(async (id: string, criteria: string | null) => {
    const value = criteria && criteria.trim() ? criteria.trim() : null;
    const supabase = getSupabase();
    setStages((cur) => cur.map((s) => (s.id === id ? { ...s, ai_criteria: value } : s)));
    const { error: err } = await supabase.from('stages').update({ ai_criteria: value }).eq('id', id);
    if (err) setError(err.message);
  }, []);

  const reorderStages = useCallback(async (orderedIds: string[]) => {
    setStages((cur) => {
      const byId = new Map(cur.map((s) => [s.id, s]));
      return orderedIds.map((id, i) => ({ ...(byId.get(id) as Stage), position: i }));
    });
    const supabase = getSupabase();
    await Promise.all(orderedIds.map((id, i) => supabase.from('stages').update({ position: i }).eq('id', id)));
  }, []);

  const removeStage = useCallback<UsePipelineResult['removeStage']>(
    async (id, moveToStageId) => {
      if (stages.length <= 1) return { ok: false, error: 'O funil precisa de ao menos um estágio.' };
      const supabase = getSupabase();
      // Move os deals do estágio para o destino escolhido antes de excluir.
      const { error: mvErr } = await supabase.from('deals').update({ stage_id: moveToStageId }).eq('stage_id', id);
      if (mvErr) return { ok: false, error: mvErr.message };
      const { error: delErr } = await supabase.from('stages').delete().eq('id', id);
      if (delErr) return { ok: false, error: delErr.message };
      setStages((cur) => cur.filter((s) => s.id !== id));
      setDeals((cur) => cur.map((d) => (d.stage_id === id ? { ...d, stage_id: moveToStageId } : d)));
      return { ok: true };
    },
    [stages],
  );

  // Ações em massa no funil — move/atribui/marca vários negócios selecionados
  // de uma vez. Sempre em lotes de 100 (mesmo padrão de useContacts.ts) para
  // não estourar o filtro `.in()` de uma seleção grande.
  const bulkMoveStage = useCallback(
    async (dealIds: string[], stageId: string): Promise<{ ok: boolean; error?: string }> => {
      if (dealIds.length === 0) return { ok: true };
      const stage = stages.find((s) => s.id === stageId);
      const patch: Partial<Deal> = { stage_id: stageId };
      if (stage?.is_won) patch.status = 'won';
      else if (stage?.is_lost) patch.status = 'lost';
      else patch.status = 'open';
      const supabase = getSupabase();
      for (const chunk of chunkArray(dealIds, IN_FILTER_CHUNK_SIZE)) {
        const { error: err } = await supabase.from('deals').update(patch).in('id', chunk);
        if (err) return { ok: false, error: err.message };
      }
      setDeals((cur) => cur.map((d) => (dealIds.includes(d.id) ? { ...d, ...patch } : d)));
      return { ok: true };
    },
    [stages],
  );

  const bulkAssignOwner = useCallback(
    async (dealIds: string[], ownerId: string | null): Promise<{ ok: boolean; error?: string }> => {
      if (dealIds.length === 0) return { ok: true };
      const supabase = getSupabase();
      for (const chunk of chunkArray(dealIds, IN_FILTER_CHUNK_SIZE)) {
        const { error: err } = await supabase.from('deals').update({ owner_id: ownerId }).in('id', chunk);
        if (err) return { ok: false, error: err.message };
      }
      setDeals((cur) => cur.map((d) => (dealIds.includes(d.id) ? { ...d, owner_id: ownerId } : d)));
      return { ok: true };
    },
    [],
  );

  const bulkAddTag = useCallback(
    async (dealIds: string[], tagId: string): Promise<{ ok: boolean; error?: string }> => {
      if (dealIds.length === 0) return { ok: true };
      const supabase = getSupabase();
      const rows = dealIds.map((deal_id) => ({ deal_id, tag_id: tagId }));
      for (const chunk of chunkArray(rows, IN_FILTER_CHUNK_SIZE)) {
        const { error: err } = await supabase.from('deal_tags').upsert(chunk, { onConflict: 'deal_id,tag_id' });
        if (err) return { ok: false, error: err.message };
      }
      await reload();
      return { ok: true };
    },
    [reload],
  );

  return {
    pipelines, selectedId, select, pipeline, stages, deals, loading, error, reload,
    moveDeal, createDeal,
    bulkMoveStage, bulkAssignOwner, bulkAddTag,
    createPipeline, renamePipeline, deletePipeline, setDefaultPipeline,
    addStage, renameStage, setStageColor, setStageProbability, setStageAiCriteria, reorderStages, removeStage,
  };
}
