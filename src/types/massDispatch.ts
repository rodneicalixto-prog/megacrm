// Tipos do canal de disparo em massa via Evolution (WhatsApp Web) — módulo
// paralelo a Campanhas (que usa Zernio/templates aprovados pela Meta). Ver
// supabase/migrations/20260821250000_mass_dispatch.sql para o schema.

export type MassDispatchStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed';
export type MassDispatchContactStatus = 'pending' | 'sent' | 'replied' | 'failed';

export type DispatchAudienceMode = 'all' | 'tags' | 'file';

export interface DispatchAudienceFilter {
  mode: DispatchAudienceMode;
  tag_ids?: string[];
  file_id?: string;
}

export interface MassDispatch {
  id: string;
  name: string;
  connection_id: string;
  status: MassDispatchStatus;
  audience_filter: DispatchAudienceFilter;
  min_delay_seconds: number;
  max_delay_seconds: number;
  scheduled_at: string | null;
  next_send_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_contacts: number;
  sent: number;
  replied: number;
  failed: number;
  created_by: string | null;
  created_at: string;
}

export interface MassDispatchMessage {
  id: string;
  dispatch_id: string;
  content: string;
  media_url: string | null;
  media_type: string | null;
  position: number;
  created_at: string;
}

export interface MassDispatchContact {
  id: string;
  dispatch_id: string;
  contact_id: string;
  status: MassDispatchContactStatus;
  message_id_used: string | null;
  error_message: string | null;
  evolution_message_id: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  created_at: string;
  // Preenchido só quando embutido via PostgREST (contact:contact_id(...)).
  contact?: { id: string; name: string | null; phone: string } | null;
}

export type DispatchFileType = 'contact_list' | 'attachment';

export interface DispatchFile {
  id: string;
  name: string;
  file_type: DispatchFileType;
  storage_path: string;
  media_type: string | null;
  file_size_bytes: number | null;
  contact_ids: string[] | null;
  uploaded_by: string | null;
  created_at: string;
}

export const MASS_DISPATCH_STATUS_LABEL: Record<MassDispatchStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  sending: 'Enviando',
  paused: 'Pausado',
  completed: 'Concluído',
  failed: 'Falhou',
};

export const DISPATCH_CONTACT_STATUS_LABEL: Record<MassDispatchContactStatus, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  replied: 'Respondeu',
  failed: 'Falhou',
};
