import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface QuickReply {
  id: string;
  shortcut: string;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UseQuickRepliesResult {
  quickReplies: QuickReply[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (shortcut: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  update: (id: string, fields: { shortcut?: string; content?: string }) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

// Respostas rápidas (/atalho) — atalhos compartilhados por toda a instância,
// usados pelo autocomplete do MessageInput no Inbox.
export function useQuickReplies(): UseQuickRepliesResult {
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .schema('whatsapp_hub')
      .from('quick_replies')
      .select('*')
      .order('shortcut', { ascending: true });
    if (err) setError(err.message);
    else setQuickReplies((data ?? []) as QuickReply[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (shortcut: string, content: string) => {
      const supabase = getSupabase();
      const { data: userData } = await supabase.auth.getUser();
      const { error: err } = await supabase
        .schema('whatsapp_hub')
        .from('quick_replies')
        .insert({ shortcut: shortcut.trim().toLowerCase(), content: content.trim(), created_by: userData.user?.id ?? null });
      if (err) return { ok: false, error: err.message };
      await reload();
      return { ok: true };
    },
    [reload],
  );

  const update = useCallback(
    async (id: string, fields: { shortcut?: string; content?: string }) => {
      const supabase = getSupabase();
      const patch: Record<string, string> = {};
      if (fields.shortcut !== undefined) patch.shortcut = fields.shortcut.trim().toLowerCase();
      if (fields.content !== undefined) patch.content = fields.content.trim();
      const { error: err } = await supabase.schema('whatsapp_hub').from('quick_replies').update(patch).eq('id', id);
      if (err) return { ok: false, error: err.message };
      await reload();
      return { ok: true };
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const supabase = getSupabase();
      const { error: err } = await supabase.schema('whatsapp_hub').from('quick_replies').delete().eq('id', id);
      if (err) return { ok: false, error: err.message };
      await reload();
      return { ok: true };
    },
    [reload],
  );

  return { quickReplies, loading, error, reload, create, update, remove };
}
