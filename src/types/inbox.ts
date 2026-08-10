export type ConversationStatus = 'ai_active' | 'human_active' | 'closed';
export type ConversationChannel = 'whatsapp' | 'instagram' | 'evolution';

// A janela de 24h é regra da Meta, e só existe na rota oficial (Zernio sobre a
// Cloud API): fora dela, só template reinicia a conversa. A rota não-oficial
// (Evolution/Baileys) não tem esse conceito — texto livre a qualquer momento —
// então tratá-la como "janela fechada" esconderia o campo de mensagem sem
// motivo e ofereceria um template que ela nem usa.
export function hasSessionWindow(channel: ConversationChannel | undefined): boolean {
  return channel !== 'evolution';
}
export type MessageDirection = 'inbound' | 'outbound';
export type SenderType = 'contact' | 'ai' | 'operator' | 'system';
export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'template' | 'note';
export type MetaMessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface Conversation {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  // Negócio (deal) que esta conversa está tratando, fixado pelo operador quando
  // o contato tem vários negócios abertos. Independente do responsável.
  active_deal_id: string | null;
  ai_paused: boolean;
  channel: ConversationChannel;
  last_message_at: string | null;
  unread_count: number;
  pinned_note: string | null;
  archived: boolean;
  // Prioridade do atendimento — 'alta' alimenta a fila homônima do inbox.
  priority: 'baixa' | 'normal' | 'alta';
  // Departamento dono da conversa e linha (número) que a recebeu.
  department_id: string | null;
  connection_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender_type: SenderType;
  sender_id: string | null;
  content_type: ContentType;
  content: string | null;
  media_url: string | null;
  zernio_message_id: string | null;
  // Status de entrega relayado pelo Zernio (coluna meta_status mantida).
  meta_status: MetaMessageStatus | null;
  is_private_note: boolean;
  created_at: string;
}

export interface ConversationWithContact extends Conversation {
  contact: {
    id: string;
    // Nullable: contatos Instagram não têm telefone.
    phone: string | null;
    name: string | null;
    email: string | null;
    custom_fields: Record<string, unknown>;
  } | null;
  lastMessagePreview: string | null;
  // IDs das tags do contato — usados pelo filtro de Tags do inbox (Módulo 7).
  tagIds: string[];
  // Timestamp da última mensagem do CONTATO (inbound) — deriva a janela de 24h
  // da Meta sem coluna dedicada.
  lastInboundAt: string | null;
  // Última mensagem NOSSA. Junto com lastInboundAt diz de quem é a vez, que é
  // o que separa a fila "Aguardando" da "Aguardando cliente".
  lastOutboundAt: string | null;
  // Favorito DESTE usuário (conversation_favorites é por pessoa).
  isFavorite: boolean;
}
