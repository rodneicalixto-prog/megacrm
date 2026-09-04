export type LegalCaseStatus =
  | 'em_andamento'
  | 'atrasado'
  | 'elaborando_defesa'
  | 'pendente_documentacao'
  | 'encerrado';

export type LegalCaseOutcome = 'acordo' | 'procedente' | 'improcedente';
export type LegalCaseSide = 'empresa' | 'reclamante';
export type LegalBriefingTriggerType =
  | 'manual'
  | 'versao_inicial'
  | 'novo_anexo'
  | 'nova_mensagem'
  | 'status_alterado'
  | 'tarefa_concluida'
  | 'sentenca_ou_decisao';

export interface LegalCase {
  id: string;
  case_number: string | null;
  title: string;
  department_id: string;
  status: LegalCaseStatus;
  outcome: LegalCaseOutcome | null;
  next_deadline_at: string | null;
  next_deadline_label: string | null;
  owner_id: string | null;
  external_counsel: string | null;
  opposing_party: string | null;
  court_reference: string | null;
  classification: string | null;
  summary: string | null;
  chat_paused_at: string | null;
  last_message_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalCaseParticipant {
  id: string;
  case_id: string;
  user_id: string | null;
  external_name: string | null;
  role_label: string;
  added_by: string | null;
  created_at: string;
}

export interface LegalCaseTask {
  id: string;
  case_id: string;
  title: string;
  due_at: string | null;
  owner_id: string | null;
  done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalCaseChecklistItem {
  id: string;
  task_id: string;
  label: string;
  position: number;
  done: boolean;
  created_at: string;
}

export interface LegalCaseWitness {
  id: string;
  case_id: string;
  name: string;
  role_label: string | null;
  side: LegalCaseSide;
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface LegalCaseAttachment {
  id: string;
  case_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface LegalCaseMessage {
  id: string;
  case_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
}

export interface LegalCaseBriefing {
  id: string;
  case_id: string;
  version: number;
  trigger_type: LegalBriefingTriggerType;
  trigger_label: string | null;
  summary_text: string;
  classification: string | null;
  clt_refs: Array<{ tag: string; desc: string }>;
  cct_notes: unknown[];
  precedents: unknown[];
  defense_ideas: string[];
  generated_by: string | null;
  created_at: string;
}

export interface LegalCaseCourtMovement {
  id: string;
  case_id: string;
  occurred_at: string;
  description: string;
  source: 'manual' | 'trt_sync';
  external_ref: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LegalDashboardStats {
  volume_by_status: Partial<Record<LegalCaseStatus, number>>;
  outcome_breakdown: Partial<Record<LegalCaseOutcome, number>>;
  classification_ranking: Array<{ classification: string; count: number }>;
}

export const LEGAL_ATTACHMENTS_BUCKET = 'whatsapp-hub-legal-attachments';
