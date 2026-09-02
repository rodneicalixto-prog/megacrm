import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';

export interface AttendanceGroup {
  id: string;
  name: string;
  color: string;
  conversationIds: string[];
}

export function useAttendanceGroups() {
  const { userId } = useAppUser();
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);

  const reload = useCallback(async () => {
    if (!userId) return;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('attendance_groups')
      .select('id, name, color, attendance_group_conversations(conversation_id)')
      .order('created_at');
    if (error) throw new Error(error.message);
    setGroups((data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      color: row.color as string,
      conversationIds: ((row.attendance_group_conversations ?? []) as Array<{ conversation_id: string }>)
        .map((item) => item.conversation_id),
    })));
  }, [userId]);

  useEffect(() => { void reload(); }, [reload]);

  const create = async (name: string) => {
    const { error } = await getSupabase().from('attendance_groups').insert({ name: name.trim() });
    if (error) throw new Error(error.message);
    await reload();
  };

  const remove = async (id: string) => {
    const { error } = await getSupabase().from('attendance_groups').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await reload();
  };

  const setConversationGroups = async (conversationId: string, groupIds: string[]) => {
    const supabase = getSupabase();
    const owned = new Set(groups.map((group) => group.id));
    const safeIds = groupIds.filter((id) => owned.has(id));
    const { error: deleteError } = await supabase
      .from('attendance_group_conversations')
      .delete()
      .eq('conversation_id', conversationId)
      .in('group_id', Array.from(owned));
    if (deleteError) throw new Error(deleteError.message);
    if (safeIds.length) {
      const { error } = await supabase.from('attendance_group_conversations').insert(
        safeIds.map((group_id) => ({ group_id, conversation_id: conversationId })),
      );
      if (error) throw new Error(error.message);
    }
    await reload();
  };

  return { groups, create, remove, setConversationGroups };
}
