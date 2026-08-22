import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { chunkArray } from '@/lib/chunk';
import type { DispatchAudienceFilter, MassDispatch } from '@/types/massDispatch';

interface DispatchMessageInput {
  content: string;
  media_url?: string | null;
  media_type?: string | null;
}

interface CreateDispatchInput {
  name: string;
  connection_id: string;
  audience_filter: DispatchAudienceFilter;
  messages: DispatchMessageInput[];
  min_delay_seconds: number;
  max_delay_seconds: number;
  scheduled_at: string | null; // ISO; null = start immediately
}

interface UseMassDispatchesResult {
  dispatches: MassDispatch[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createAndQueue: (input: CreateDispatchInput) => Promise<{ dispatch: MassDispatch; queued: number } | null>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  previewAudience: (filter: DispatchAudienceFilter) => Promise<number>;
}

// Resolve o filtro de audiência em IDs de contato. 'file' lê os contact_ids já
// resolvidos no upload da lista (mass_dispatch_files); 'tags' e 'all' seguem o
// mesmo padrão de segurança do useCampaigns.ts: filtro vazio nunca vira "todo
// mundo" por acidente.
async function resolveAudienceIds(filter: DispatchAudienceFilter): Promise<string[]> {
  const supabase = getSupabase();

  if (filter.mode === 'all') {
    const { data, error } = await supabase.schema('whatsapp_hub').from('contacts').select('id');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  if (filter.mode === 'file') {
    if (!filter.file_id) return [];
    const { data, error } = await supabase
      .schema('whatsapp_hub')
      .from('mass_dispatch_files')
      .select('contact_ids')
      .eq('id', filter.file_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return ((data as { contact_ids: string[] | null } | null)?.contact_ids ?? []);
  }

  if (filter.mode === 'tags') {
    const tagIds = filter.tag_ids ?? [];
    if (tagIds.length === 0) return [];
    const { data, error } = await supabase
      .schema('whatsapp_hub')
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', tagIds);
    if (error) throw new Error(error.message);
    return Array.from(new Set(((data ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id)));
  }

  return [];
}

export function useMassDispatches(): UseMassDispatchesResult {
  const { userId } = useAppUser();
  const [dispatches, setDispatches] = useState<MassDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from('mass_dispatches')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setDispatches((data ?? []) as MassDispatch[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    const channelName = `mass_dispatches:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp_hub', table: 'mass_dispatches' },
        () => void reload(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  const previewAudience = async (filter: DispatchAudienceFilter): Promise<number> => {
    if (!userId) return 0;
    const ids = await resolveAudienceIds(filter);
    return ids.length;
  };

  const createAndQueue: UseMassDispatchesResult['createAndQueue'] = async (input) => {
    if (!userId) return null;
    const supabase = getSupabase();

    const contactIds = await resolveAudienceIds(input.audience_filter);
    if (contactIds.length === 0) {
      throw new Error('Nenhum contato corresponde aos filtros da audiência.');
    }
    if (input.messages.length === 0) {
      throw new Error('Adicione pelo menos um modelo de mensagem.');
    }

    const { data: dispatch, error: err } = await supabase
      .from('mass_dispatches')
      .insert({
        name: input.name,
        connection_id: input.connection_id,
        status: input.scheduled_at ? 'scheduled' : 'sending',
        scheduled_at: input.scheduled_at,
        audience_filter: input.audience_filter,
        min_delay_seconds: input.min_delay_seconds,
        max_delay_seconds: input.max_delay_seconds,
        total_contacts: contactIds.length,
        started_at: input.scheduled_at ? null : new Date().toISOString(),
        created_by: userId,
      })
      .select()
      .single();
    if (err || !dispatch) {
      throw new Error(err?.message ?? 'Falha ao criar disparo');
    }
    const created = dispatch as MassDispatch;

    const { error: msgErr } = await supabase.schema('whatsapp_hub').from('mass_dispatch_messages').insert(
      input.messages.map((m, i) => ({
        dispatch_id: created.id,
        content: m.content,
        media_url: m.media_url ?? null,
        media_type: m.media_type ?? null,
        position: i,
      })),
    );
    if (msgErr) throw new Error(msgErr.message);

    // Materializa a fila em lotes, mesmo padrão de useCampaigns.ts.
    const CHUNK = 500;
    for (const part of chunkArray(contactIds, CHUNK)) {
      const { error: insErr } = await supabase.schema('whatsapp_hub').from('mass_dispatch_contacts').insert(
        part.map((contact_id) => ({ dispatch_id: created.id, contact_id, status: 'pending' as const })),
      );
      if (insErr) throw new Error(insErr.message);
    }

    await reload();
    return { dispatch: created, queued: contactIds.length };
  };

  const pause: UseMassDispatchesResult['pause'] = async (id) => {
    const supabase = getSupabase();
    const { error: err } = await supabase.from('mass_dispatches').update({ status: 'paused' }).eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateDbError(err.message));
    }
    await reload();
  };

  const resume: UseMassDispatchesResult['resume'] = async (id) => {
    const supabase = getSupabase();
    const { error: err } = await supabase.from('mass_dispatches').update({ status: 'sending' }).eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateDbError(err.message));
    }
    await reload();
  };

  const remove: UseMassDispatchesResult['remove'] = async (id) => {
    const supabase = getSupabase();
    const { error: err } = await supabase.schema('whatsapp_hub').from('mass_dispatches').delete().eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateDbError(err.message));
    }
    await reload();
  };

  return { dispatches, loading, error, reload, createAndQueue, pause, resume, remove, previewAudience };
}

function translateDbError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('duplicate key')) return 'Registro duplicado — verifique os dados informados.';
  if (lower.includes('row-level security') || lower.includes('permission denied')) return 'Você não tem permissão para esta ação.';
  if (lower.includes('violates foreign key')) return 'Não é possível concluir: há registros vinculados.';
  if (lower.includes('violates check constraint') || lower.includes('invalid input')) return 'Dados inválidos — revise os campos e tente novamente.';
  return message || 'Não foi possível concluir a operação.';
}
