export interface InternalConversationRow {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string | null;
  last_read_a: string | null;
  last_read_b: string | null;
}

export interface InternalMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/** Conversa já resolvida do ponto de vista do usuário logado. */
export interface InternalConversation {
  id: string;
  peer_id: string;
  last_message_at: string | null;
  unread: boolean;
}
