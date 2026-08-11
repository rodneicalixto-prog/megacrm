import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';

export interface Calendar {
  id: string;
  name: string;
  color: string;
  owner_id: string | null;
  is_company: boolean;
}

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  created_by: string | null;
}

export interface NewEvent {
  calendar_id: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at: string;
  all_day?: boolean;
  location?: string | null;
}

// Agenda do usuário: o calendário dele + o da empresa. A RLS já limita o que
// volta, então o hook não refaz o filtro — duas regras de visibilidade em
// lugares diferentes divergem na primeira mudança.
export function useAgenda(from: Date, to: Date) {
  const { userId, role } = useAppUser();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase().schema('whatsapp_hub');
    const [cals, evs] = await Promise.all([
      supabase.from('calendars').select('*').order('is_company', { ascending: false }),
      supabase
        .from('calendar_events')
        .select('*')
        // Sobreposição, não contenção: um evento que começou ontem e termina
        // amanhã pertence a hoje, e um filtro só por starts_at o esconderia.
        .lt('starts_at', toIso)
        .gt('ends_at', fromIso)
        .order('starts_at'),
    ]);
    if (cals.error) setError(cals.error.message);
    if (evs.error) setError(evs.error.message);
    setCalendars((cals.data ?? []) as Calendar[]);
    setEvents((evs.data ?? []) as CalendarEvent[]);
    setLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const companyCalendar = useMemo(
    () => calendars.find((c) => c.is_company) ?? null,
    [calendars],
  );
  const myCalendar = useMemo(
    () => calendars.find((c) => c.owner_id === userId) ?? null,
    [calendars, userId],
  );

  // Só gerência e diretoria escrevem no calendário da empresa. A checagem de
  // verdade é a policy; isto existe para não oferecer um botão que vai falhar.
  const canWriteCompany = role === 'admin' || role === 'super_admin';

  const createEvent = useCallback(async (ev: NewEvent) => {
    const supabase = getSupabase().schema('whatsapp_hub');
    const { error: err } = await supabase
      .from('calendar_events')
      .insert({ ...ev, created_by: userId });
    if (err) throw new Error(err.message);
    await reload();
  }, [reload, userId]);

  const deleteEvent = useCallback(async (id: string) => {
    const supabase = getSupabase().schema('whatsapp_hub');
    const { data, error: err } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', id)
      .select('id');
    if (err) throw new Error(err.message);
    // RLS pode transformar um DELETE sem permissao em sucesso com zero linhas.
    // Conferir o retorno evita que a interface anuncie uma exclusao inexistente.
    if (!data?.length) throw new Error('Compromisso não encontrado ou sem permissão para excluir.');
    await reload();
  }, [reload]);

  return {
    calendars, events, loading, error, reload,
    companyCalendar, myCalendar, canWriteCompany,
    createEvent, deleteEvent,
  };
}
