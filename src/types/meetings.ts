export type MeetingStatus = 'scheduled' | 'recording' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  department_id: string | null;
  created_by: string | null;
  starts_at: string;
  ends_at: string;
  attendees: string[];
  status: MeetingStatus;
  google_event_id: string | null;
  meet_link: string | null;
  recall_bot_id: string | null;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleMeetingInput {
  title: string;
  description?: string;
  department_id?: string | null;
  starts_at: string;
  ends_at: string;
  attendees?: string[];
}
