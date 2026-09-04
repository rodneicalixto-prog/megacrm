import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { LEGAL_ATTACHMENTS_BUCKET } from '@/types/legal';
import type {
  LegalCase,
  LegalCaseAttachment,
  LegalCaseBriefing,
  LegalCaseChecklistItem,
  LegalCaseCourtMovement,
  LegalCaseMessage,
  LegalCaseParticipant,
  LegalCaseSide,
  LegalCaseTask,
  LegalCaseWitness,
} from '@/types/legal';

interface DetailState {
  legalCase: LegalCase | null;
  participants: LegalCaseParticipant[];
  tasks: LegalCaseTask[];
  checklistByTask: Record<string, LegalCaseChecklistItem[]>;
  witnesses: LegalCaseWitness[];
  attachments: LegalCaseAttachment[];
  messages: LegalCaseMessage[];
  briefings: LegalCaseBriefing[];
  movements: LegalCaseCourtMovement[];
}

const EMPTY: DetailState = {
  legalCase: null,
  participants: [],
  tasks: [],
  checklistByTask: {},
  witnesses: [],
  attachments: [],
  messages: [],
  briefings: [],
  movements: [],
};

// Um processo é bastante coisa junta (7 tabelas) — carregado num hook só
// porque a tela de detalhe é uma única página com abas, não telas
// independentes; mesmo espírito de useMassDispatches (CRUD + resolução).
export function useLegalCaseDetail(caseId: string | undefined) {
  const [state, setState] = useState<DetailState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!caseId) return;
    const supabase = getSupabase().schema('whatsapp_hub');
    const [caseRes, peopleRes, tasksRes, checklistRes, witnessesRes, filesRes, msgsRes, briefingsRes, movementsRes] =
      await Promise.all([
        supabase.from('legal_cases').select('*').eq('id', caseId).maybeSingle(),
        supabase.from('legal_case_participants').select('*').eq('case_id', caseId).order('created_at'),
        supabase.from('legal_case_tasks').select('*').eq('case_id', caseId).order('due_at', { ascending: true, nullsFirst: false }),
        supabase.from('legal_case_checklist_items').select('*, legal_case_tasks!inner(case_id)').eq('legal_case_tasks.case_id', caseId).order('position'),
        supabase.from('legal_case_witnesses').select('*').eq('case_id', caseId).order('created_at'),
        supabase.from('legal_case_attachments').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
        supabase.from('legal_case_messages').select('*').eq('case_id', caseId).order('created_at'),
        supabase.from('legal_case_briefings').select('*').eq('case_id', caseId).order('version', { ascending: false }),
        supabase.from('legal_case_court_movements').select('*').eq('case_id', caseId).order('occurred_at', { ascending: false }),
      ]);

    const firstError =
      caseRes.error || peopleRes.error || tasksRes.error || checklistRes.error || witnessesRes.error
      || filesRes.error || msgsRes.error || briefingsRes.error || movementsRes.error;
    if (firstError) {
      console.error('[useLegalCaseDetail] falha ao carregar processo', firstError);
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const checklistByTask: Record<string, LegalCaseChecklistItem[]> = {};
    for (const item of (checklistRes.data ?? []) as LegalCaseChecklistItem[]) {
      (checklistByTask[item.task_id] ??= []).push(item);
    }

    setError(null);
    setState({
      legalCase: (caseRes.data ?? null) as LegalCase | null,
      participants: (peopleRes.data ?? []) as LegalCaseParticipant[],
      tasks: (tasksRes.data ?? []) as LegalCaseTask[],
      checklistByTask,
      witnesses: (witnessesRes.data ?? []) as LegalCaseWitness[],
      attachments: (filesRes.data ?? []) as LegalCaseAttachment[],
      messages: (msgsRes.data ?? []) as LegalCaseMessage[],
      briefings: (briefingsRes.data ?? []) as LegalCaseBriefing[],
      movements: (movementsRes.data ?? []) as LegalCaseCourtMovement[],
    });
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    void reload();
    const suffix = Math.random().toString(36).slice(2, 10);
    const channel = getSupabase()
      .channel(`legal-case-detail:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'whatsapp_hub', table: 'legal_case_tasks', filter: `case_id=eq.${caseId}` }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'whatsapp_hub', table: 'legal_case_messages', filter: `case_id=eq.${caseId}` }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'whatsapp_hub', table: 'legal_case_briefings', filter: `case_id=eq.${caseId}` }, () => void reload())
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [caseId, reload]);

  // ---- mutações ----

  const addTask = useCallback(async (title: string, dueAt: string | null, ownerId: string | null) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_tasks')
      .insert({ case_id: caseId, title, due_at: dueAt, owner_id: ownerId });
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  const toggleTaskDone = useCallback(async (taskId: string, done: boolean) => {
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_tasks')
      .update({ done, done_at: done ? new Date().toISOString() : null })
      .eq('id', taskId);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  const addChecklistItem = useCallback(async (taskId: string, label: string, position: number) => {
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_checklist_items')
      .insert({ task_id: taskId, label, position });
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  const toggleChecklistItem = useCallback(async (itemId: string, done: boolean) => {
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_checklist_items')
      .update({ done }).eq('id', itemId);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  const addWitness = useCallback(async (name: string, roleLabel: string, side: LegalCaseSide) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_witnesses')
      .insert({ case_id: caseId, name, role_label: roleLabel, side });
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  const removeWitness = useCallback(async (witnessId: string) => {
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_witnesses')
      .delete().eq('id', witnessId);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  // Upload direto do client (sem Edge Function — sem efeito colateral
  // externo a coordenar, diferente de Reuniões). Bucket privado: a policy de
  // SELECT em storage.objects já é o que protege o signed URL depois.
  const uploadAttachment = useCallback(async (file: File) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const path = `${caseId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadErr } = await getSupabase().storage
      .from(LEGAL_ATTACHMENTS_BUCKET)
      .upload(path, file);
    if (uploadErr) return { ok: false as const, error: uploadErr.message };

    const { error: insertErr } = await getSupabase().schema('whatsapp_hub').from('legal_case_attachments').insert({
      case_id: caseId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    });
    if (insertErr) return { ok: false as const, error: insertErr.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  const getAttachmentUrl = useCallback(async (storagePath: string) => {
    const { data, error: err } = await getSupabase().storage
      .from(LEGAL_ATTACHMENTS_BUCKET)
      .createSignedUrl(storagePath, 120);
    if (err || !data) return { ok: false as const, error: err?.message ?? 'falha ao gerar link' };
    return { ok: true as const, url: data.signedUrl };
  }, []);

  const deleteAttachment = useCallback(async (attachment: LegalCaseAttachment) => {
    await getSupabase().storage.from(LEGAL_ATTACHMENTS_BUCKET).remove([attachment.storage_path]);
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_attachments')
      .delete().eq('id', attachment.id);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [reload]);

  const sendMessage = useCallback(async (content: string, senderId: string) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_messages')
      .insert({ case_id: caseId, sender_id: senderId, content });
    if (err) return { ok: false as const, error: err.message };
    return { ok: true as const };
  }, [caseId]);

  const setChatPaused = useCallback(async (paused: boolean) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_cases')
      .update({ chat_paused_at: paused ? new Date().toISOString() : null }).eq('id', caseId);
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  const addParticipant = useCallback(async (roleLabel: string, userId: string | null, externalName: string | null) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_participants')
      .insert({ case_id: caseId, role_label: roleLabel, user_id: userId, external_name: externalName });
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  // Nova versão do briefing — sempre via RPC (append-only, nunca UPDATE
  // direto na tabela; ver 20260904120600_legal_case_briefings.sql).
  const appendBriefing = useCallback(async (summaryText: string, triggerLabel: string) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').rpc('append_legal_case_briefing', {
      p_case_id: caseId,
      p_trigger_type: 'manual',
      p_trigger_label: triggerLabel,
      p_summary_text: summaryText,
    });
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  const addCourtMovement = useCallback(async (occurredAt: string, description: string) => {
    if (!caseId) return { ok: false as const, error: 'sem processo' };
    const { error: err } = await getSupabase().schema('whatsapp_hub').from('legal_case_court_movements')
      .insert({ case_id: caseId, occurred_at: occurredAt, description, source: 'manual' });
    if (err) return { ok: false as const, error: err.message };
    await reload();
    return { ok: true as const };
  }, [caseId, reload]);

  return {
    ...state,
    loading,
    error,
    reload,
    addTask,
    toggleTaskDone,
    addChecklistItem,
    toggleChecklistItem,
    addWitness,
    removeWitness,
    uploadAttachment,
    getAttachmentUrl,
    deleteAttachment,
    sendMessage,
    setChatPaused,
    addParticipant,
    appendBriefing,
    addCourtMovement,
  };
}
