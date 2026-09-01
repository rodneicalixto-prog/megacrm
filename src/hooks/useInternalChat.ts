import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { InternalConversation, InternalConversationRow, InternalMessage } from '@/types/internalChat';

function resolve(row: InternalConversationRow, myId: string): InternalConversation {
  const peer_id = row.user_a === myId ? row.user_b : row.user_a;
  const lastRead = row.user_a === myId ? row.last_read_a : row.last_read_b;
  const unread = Boolean(
    row.last_message_at && (!lastRead || new Date(row.last_message_at) > new Date(lastRead)),
  );
  return { id: row.id, peer_id, last_message_at: row.last_message_at, unread };
}

// Lista de conversas 1:1 do usuário logado + realtime. A tela decide qual
// abrir; este hook só mantém a lista e o contador de não lidas atualizados.
export function useInternalConversations() {
  const { userId } = useAppUser();
  const [conversations, setConversations] = useState<InternalConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    const { data, error: err } = await getSupabase()
      .schema('whatsapp_hub')
      .from('internal_conversations')
      .select('id, user_a, user_b, last_message_at, last_read_a, last_read_b')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (err) {
      console.error('[useInternalConversations] falha ao carregar conversas', err);
      setError(err.message);
      setLoading(false);
      return;
    }
    setError(null);
    setConversations(((data ?? []) as InternalConversationRow[]).map((row) => resolve(row, userId)));
    setLoading(false);
  }, [userId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`internal-conversations-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp_hub', table: 'internal_conversations' },
        () => void reload(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, reload]);

  const openWith = useCallback(async (peerId: string): Promise<string | null> => {
    const { data, error } = await getSupabase()
      .schema('whatsapp_hub')
      .rpc('get_or_create_internal_conversation', { p_peer_id: peerId });
    if (error) {
      console.error('[useInternalConversations] falha ao abrir conversa', error);
      return null;
    }
    await reload();
    return (data as string) ?? null;
  }, [reload]);

  const totalUnread = conversations.filter((c) => c.unread).length;

  return { conversations, loading, error, reload, openWith, totalUnread };
}

// Mensagens de UMA conversa aberta, com realtime e "marcar como lida" ao abrir.
export function useInternalMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId) { setMessages([]); return; }
    setLoading(true);
    const { data, error: err } = await getSupabase()
      .schema('whatsapp_hub')
      .from('internal_messages')
      .select('id, conversation_id, sender_id, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (err) {
      console.error('[useInternalMessages] falha ao carregar mensagens', err);
      setError(err.message);
      setLoading(false);
      return;
    }
    setError(null);
    setMessages((data ?? []) as InternalMessage[]);
    setLoading(false);
    const { error: readErr } = await getSupabase()
      .schema('whatsapp_hub')
      .rpc('mark_internal_conversation_read', { p_conversation_id: conversationId });
    if (readErr) console.error('[useInternalMessages] falha ao marcar como lida', readErr);
  }, [conversationId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!conversationId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`internal-messages-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'whatsapp_hub', table: 'internal_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((current) => [...current, payload.new as InternalMessage]);
          void getSupabase()
            .schema('whatsapp_hub')
            .rpc('mark_internal_conversation_read', { p_conversation_id: conversationId });
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId]);

  // Não recarrega a lista após o insert: a mesma mensagem chega de volta pelo
  // canal realtime (o remetente também está inscrito), e recarregar aqui
  // duplicaria a bolha na tela por causa da corrida entre os dois caminhos.
  const send = useCallback(async (content: string) => {
    if (!conversationId || !content.trim()) return;
    const { data } = await getSupabase().auth.getUser();
    const senderId = data.user?.id;
    if (!senderId) return;
    const { error: sendErr } = await getSupabase()
      .schema('whatsapp_hub')
      .from('internal_messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, content: content.trim() });
    if (sendErr) {
      console.error('[useInternalMessages] falha ao enviar mensagem', sendErr);
      setError(sendErr.message);
      return;
    }
    setError(null);
  }, [conversationId]);

  return { messages, loading, error, send };
}
