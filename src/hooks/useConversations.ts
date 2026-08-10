import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { Conversation, ConversationStatus, ConversationWithContact } from '@/types/inbox';

interface UseConversationsResult {
  conversations: ConversationWithContact[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setStatus: (id: string, status: ConversationStatus) => Promise<void>;
  setAiPaused: (id: string, paused: boolean) => Promise<void>;
  setAssigned: (id: string, userId: string | null) => Promise<void>;
  setActiveDeal: (id: string, dealId: string | null) => Promise<void>;
  setPinnedNote: (id: string, note: string | null) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  setPriority: (id: string, priority: 'baixa' | 'normal' | 'alta') => Promise<void>;
  toggleFavorite: (id: string, favorite: boolean) => Promise<void>;
  transfer: (
    id: string,
    dest: { userId: string | null; departmentId: string | null; reason: string },
  ) => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  custom_fields: Record<string, unknown>;
}

export function useConversations(): UseConversationsResult {
  const { userId } = useAppUser();
  const [conversations, setConversations] = useState<ConversationWithContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // reload({ silent: true }) atualiza os dados SEM ligar o spinner global — usado
  // pelos eventos de realtime para não “piscar” a lista (e apagar o resultado
  // filtrado) a cada mensagem que chega. O primeiro load e o retry manual usam
  // o spinner normalmente.
  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!userId) return;
    if (!opts?.silent) setLoading(true);
    setError(null);
    const supabase = getSupabase();

    // Buscamos TODAS as conversas (arquivadas ou não, qualquer status) e a
    // filtragem por canal / atendente / status / atribuído / tags / janela 24h
    // acontece no cliente (Módulo 7) — combinações multi-eixo ficam simples e
    // reativas. Débito: para volumes grandes, empurrar filtros para o servidor.
    const { data: convs, error: err } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = (convs ?? []) as Conversation[];
    const contactIds = Array.from(new Set(rows.map((c) => c.contact_id)));
    const conversationIds = rows.map((c) => c.id);

    // Batch: contacts + tags do contato + latest messages + favoritos do usuário.
    const [contactsQ, tagsQ, lastMsgsQ, favsQ] = await Promise.all([
      contactIds.length === 0
        ? Promise.resolve({ data: [] as ContactRow[], error: null })
        : supabase
            .from('contacts')
            .select('id, phone, name, email, custom_fields')
            .in('id', contactIds),
      contactIds.length === 0
        ? Promise.resolve({ data: [] as Array<{ contact_id: string; tag_id: string }>, error: null })
        : supabase
            .from('contact_tags')
            .select('contact_id, tag_id')
            .in('contact_id', contactIds),
      conversationIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('messages')
            .select('conversation_id, content, content_type, created_at, is_private_note, direction')
            .in('conversation_id', conversationIds)
            .order('created_at', { ascending: false }),
      // RLS já limita a linha ao próprio usuário; o filtro explícito evita
      // depender disso para a correção do que aparece na estrela.
      supabase
        .from('conversation_favorites')
        .select('conversation_id')
        .eq('user_id', userId),
    ]);

    if (contactsQ.error) {
      setError(contactsQ.error.message);
      setLoading(false);
      return;
    }
    const contactsById = new Map<string, ContactRow>();
    for (const c of (contactsQ.data ?? []) as ContactRow[]) contactsById.set(c.id, c);

    // Tags por contato (para o filtro de Tags do inbox).
    const tagsByContact = new Map<string, string[]>();
    for (const t of (tagsQ.data ?? []) as Array<{ contact_id: string; tag_id: string }>) {
      const arr = tagsByContact.get(t.contact_id) ?? [];
      arr.push(t.tag_id);
      tagsByContact.set(t.contact_id, arr);
    }

    // Percorre mensagens (ordenadas desc): 1ª não-privada = preview; 1ª inbound
    // = última mensagem do contato (janela de 24h).
    const latestByConv = new Map<string, string>();
    const lastInboundByConv = new Map<string, string>();
    const lastOutboundByConv = new Map<string, string>();
    for (const m of (lastMsgsQ.data ?? []) as Array<{
      conversation_id: string;
      content: string | null;
      content_type: string;
      is_private_note: boolean;
      direction: 'inbound' | 'outbound';
      created_at: string;
    }>) {
      if (!latestByConv.has(m.conversation_id) && !m.is_private_note) {
        const preview = m.content ?? (m.content_type === 'text' ? '' : `[${m.content_type}]`);
        latestByConv.set(m.conversation_id, preview);
      }
      if (m.direction === 'inbound' && !lastInboundByConv.has(m.conversation_id)) {
        lastInboundByConv.set(m.conversation_id, m.created_at);
      }
      // Nota privada não é resposta ao contato: contá-la como saída faria a
      // conversa sair de "Aguardando" sem ninguém ter respondido nada.
      if (
        m.direction === 'outbound'
        && !m.is_private_note
        && !lastOutboundByConv.has(m.conversation_id)
      ) {
        lastOutboundByConv.set(m.conversation_id, m.created_at);
      }
    }

    const favoriteIds = new Set(
      ((favsQ.data ?? []) as Array<{ conversation_id: string }>).map((f) => f.conversation_id),
    );

    const merged: ConversationWithContact[] = rows.map((c) => ({
      ...c,
      contact: contactsById.get(c.contact_id) ?? null,
      lastMessagePreview: latestByConv.get(c.id) ?? null,
      tagIds: tagsByContact.get(c.contact_id) ?? [],
      lastInboundAt: lastInboundByConv.get(c.id) ?? null,
      lastOutboundAt: lastOutboundByConv.get(c.id) ?? null,
      isFavorite: favoriteIds.has(c.id),
    }));

    setConversations(merged);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime subscription — any INSERT/UPDATE/DELETE on conversations OR a
  // new row in messages (which bumps last_message_at) triggers a refresh.
  // Randomized channel names to survive StrictMode double-mount.
  // O refresh é SILENCIOSO (sem spinner) e com debounce, para uma rajada de
  // eventos não recarregar N vezes nem esconder a lista filtrada.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    const suffix = Math.random().toString(36).slice(2, 10);
    const scheduleReload = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { void reload({ silent: true }); }, 400);
    };
    const channel = supabase
      .channel(`inbox:${suffix}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'whatsapp_hub',
          table: 'conversations',
        },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'whatsapp_hub',
          table: 'messages',
        },
        scheduleReload,
      )
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  const setStatus: UseConversationsResult['setStatus'] = async (id, next) => {
    const supabase = getSupabase();
    const patch: Record<string, unknown> = { status: next };
    if (next === 'closed') patch.closed_at = new Date().toISOString();
    const { error } = await supabase.schema('whatsapp_hub').from('conversations').update(patch).eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const setAiPaused: UseConversationsResult['setAiPaused'] = async (id, paused) => {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('conversations')
      .update({ ai_paused: paused, status: paused ? 'human_active' : 'ai_active' })
      .eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const setAssigned: UseConversationsResult['setAssigned'] = async (id, assignee) => {
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('conversations')
      .update({ assigned_to: assignee, assigned_at: assignee ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const setActiveDeal: UseConversationsResult['setActiveDeal'] = async (id, dealId) => {
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('conversations')
      .update({ active_deal_id: dealId })
      .eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const setPinnedNote: UseConversationsResult['setPinnedNote'] = async (id, note) => {
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('conversations')
      .update({ pinned_note: note && note.trim() ? note.trim() : null })
      .eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const setArchived: UseConversationsResult['setArchived'] = async (id, archived) => {
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('conversations')
      .update({ archived })
      .eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const setPriority: UseConversationsResult['setPriority'] = async (id, priority) => {
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('conversations')
      .update({ priority })
      .eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  const toggleFavorite: UseConversationsResult['toggleFavorite'] = async (id, favorite) => {
    const supabase = getSupabase();
    if (!userId) return;
    // Otimista: a estrela responde ao clique sem esperar o round-trip. O
    // realtime não cobre conversation_favorites, então sem isso a lista só
    // mudaria no próximo reload.
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isFavorite: favorite } : c)),
    );
    const table = supabase.schema('whatsapp_hub').from('conversation_favorites');
    const { error } = favorite
      ? await table.upsert({ conversation_id: id, user_id: userId })
      : await table.delete().eq('conversation_id', id).eq('user_id', userId);
    if (error) {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isFavorite: !favorite } : c)),
      );
      throw new Error(translateDbError(error.message));
    }
  };

  const transfer: UseConversationsResult['transfer'] = async (id, dest) => {
    const supabase = getSupabase();
    // RPC e nao dois updates: a mudanca de dono e o registro dela na thread
    // precisam acontecer juntos, senao a conversa chega no destinatario sem
    // nenhum contexto de por que caiu com ele.
    const { error } = await supabase.schema('whatsapp_hub').rpc('transfer_conversation', {
      p_conversation_id: id,
      p_to_user_id: dest.userId,
      p_to_department_id: dest.departmentId,
      p_reason: dest.reason || null,
    });
    if (error) throw new Error(translateDbError(error.message));
    await reload({ silent: true });
  };

  const markRead: UseConversationsResult['markRead'] = async (id) => {
    const supabase = getSupabase();
    const { error } = await supabase.schema('whatsapp_hub').from('conversations').update({ unread_count: 0 }).eq('id', id);
    if (error) throw new Error(translateDbError(error.message));
  };

  return { conversations, loading, error, reload, setStatus, setAiPaused, setAssigned, setActiveDeal, setPinnedNote, setArchived, setPriority, toggleFavorite, transfer, markRead };
}

// Maps the most common Postgres/PostgREST errors to actionable pt-BR messages.
function translateDbError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('duplicate key')) return 'Registro duplicado — verifique os dados informados.';
  if (lower.includes('row-level security') || lower.includes('permission denied')) return 'Você não tem permissão para esta ação.';
  if (lower.includes('violates foreign key')) return 'Não é possível concluir: há registros vinculados.';
  if (lower.includes('violates check constraint') || lower.includes('invalid input')) return 'Dados inválidos — revise os campos e tente novamente.';
  return message || 'Não foi possível concluir a operação.';
}
