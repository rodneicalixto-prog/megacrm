import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { Meeting, ScheduleMeetingInput } from '@/types/meetings';

export interface ScheduleResult {
  ok: boolean;
  error?: string;
  recall_warning?: string | null;
}

// Acervo compartilhado (sem recorte por departamento — ver RLS da tabela):
// todo mundo lê tudo, então uma reunião marcada por qualquer setor aparece
// pra todos, e o histórico/gravação/resumo ficam fáceis de achar depois.
export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await getSupabase()
      .schema('whatsapp_hub')
      .from('meetings')
      .select('*')
      .order('starts_at', { ascending: false });
    if (!error) setMeetings((data ?? []) as Meeting[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const channel = getSupabase()
      .channel('meetings-changes')
      .on('postgres_changes', { event: '*', schema: 'whatsapp_hub', table: 'meetings' }, () => void reload())
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [reload]);

  const schedule = useCallback(async (input: ScheduleMeetingInput): Promise<ScheduleResult> => {
    const { data, error } = await getSupabase().functions.invoke('schedule-meeting', { body: input });
    if (error || !data?.ok) {
      return { ok: false, error: data?.error ?? error?.message ?? 'Erro ao agendar reunião.' };
    }
    return { ok: true, recall_warning: data.recall_warning ?? null };
  }, []);

  const cancel = useCallback(async (meetingId: string): Promise<ScheduleResult> => {
    const { data, error } = await getSupabase().functions.invoke('cancel-meeting', {
      body: { meeting_id: meetingId },
    });
    if (error || !data?.ok) {
      return { ok: false, error: data?.error ?? error?.message ?? 'Erro ao cancelar reunião.' };
    }
    return { ok: true };
  }, []);

  return { meetings, loading, reload, schedule, cancel };
}
