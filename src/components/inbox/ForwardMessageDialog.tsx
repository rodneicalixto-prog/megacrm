import { useMemo, useState } from 'react';
import { Forward, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getSupabase } from '@/lib/supabase';
import type { ThreadMessage } from '@/hooks/useMessages';
import type { ConversationWithContact } from '@/types/inbox';

interface Props {
  message: ThreadMessage | null;
  conversations: ConversationWithContact[];
  currentConversationId: string;
  onClose: () => void;
}

export function ForwardMessageDialog({ message, conversations, currentConversationId, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const [sending, setSending] = useState(false);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (c.id === currentConversationId || c.status === 'closed') return false;
      const name = c.contact?.name?.toLowerCase() ?? '';
      const phone = c.contact?.phone?.toLowerCase() ?? '';
      return !q || name.includes(q) || phone.includes(q);
    });
  }, [conversations, currentConversationId, query]);

  const send = async () => {
    if (!message || !targetId) return;
    setSending(true);
    try {
      const supabase = getSupabase();
      if (message.media_url && message.content_type !== 'text') {
        const response = await fetch(message.media_url);
        if (!response.ok) throw new Error('Não foi possível baixar a mídia original.');
        const blob = await response.blob();
        const form = new FormData();
        const extension = blob.type.split('/')[1] || 'bin';
        form.append('conversation_id', targetId);
        form.append('file', new File([blob], 'encaminhada.' + extension, { type: blob.type }));
        if (message.content?.trim()) form.append('content', message.content.trim());
        const result = await supabase.functions.invoke('send-operator-media', { body: form });
        if (result.error || !result.data?.ok) throw new Error(result.data?.error ?? result.error?.message);
      } else {
        const content = message.content?.trim();
        if (!content) throw new Error('Esta mensagem não possui conteúdo encaminhável.');
        const result = await supabase.functions.invoke('send-operator-message', {
          body: { conversation_id: targetId, content, is_private_note: false },
        });
        if (result.error || !result.data?.ok) throw new Error(result.data?.error ?? result.error?.message);
      }
      toast.success('Mensagem encaminhada.');
      onClose();
    } catch (error) {
      toast.error('Falha ao encaminhar', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={Boolean(message)} onClose={onClose} title="Encaminhar mensagem">
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar contato ou telefone" className="w-full rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-elevated)] py-2.5 pl-9 pr-3 text-sm text-[var(--color-text-primary)]" />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {options.map((conversation) => {
            const name = conversation.contact?.name?.trim() || conversation.contact?.phone || 'Contato';
            return (
              <button key={conversation.id} type="button" onClick={() => setTargetId(conversation.id)} className={"flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm " + (targetId === conversation.id ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.1)]' : 'border-transparent hover:bg-white/5')}>
                <span className="font-medium text-[var(--color-text-primary)]">{name}</span>
                <span className="text-xs text-[var(--color-text-secondary)]">{conversation.contact?.phone}</span>
              </button>
            );
          })}
          {options.length === 0 && <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">Nenhuma conversa aberta encontrada.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={() => void send()} disabled={!targetId || sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Forward className="h-4 w-4" />}
            Encaminhar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
