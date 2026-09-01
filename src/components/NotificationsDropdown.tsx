import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, AtSign, Bell, CheckCheck, MessageSquare, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotifications, type NotificationRow } from '@/hooks/useNotifications';

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'agora'; if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60); if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function contactName(title: string): string {
  return title
    .replace(/^Nova mensagem de\s+/i, '')
    .replace(/^Handoff para humano:\s*/i, '')
    .replace(/^SLA estourado:\s*/i, '')
    .replace(/^Você foi mencionado por\s+/i, '')
    .trim() || 'Contato';
}

export function NotificationsDropdown() {
  const navigate = useNavigate();
  const { notifications, markConversationRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => {
    const map = new Map<string, { latest: NotificationRow; unread: number }>();
    for (const n of notifications) {
      const key = n.conversation_id ?? n.id;
      const current = map.get(key);
      if (!current) map.set(key, { latest: n, unread: n.is_read ? 0 : 1 });
      else if (!n.is_read) current.unread += 1;
    }
    return [...map.values()];
  }, [notifications]);
  const unreadContacts = grouped.filter((item) => item.unread > 0).length;
  const sections = [
    { id: 'sla', label: 'SLA estourado', items: grouped.filter((item) => item.latest.type === 'sla_breach') },
    { id: 'handoff', label: 'Aguardando atendimento', items: grouped.filter((item) => item.latest.type === 'handoff') },
    { id: 'mentions', label: 'Menções', items: grouped.filter((item) => item.latest.type === 'mention') },
    { id: 'messages', label: 'Mensagens', items: grouped.filter((item) => item.latest.type === 'new_message') },
  ].filter((section) => section.items.length > 0);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!containerRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const openConversation = async (item: { latest: NotificationRow; unread: number }) => {
    const id = item.latest.conversation_id;
    if (!id) return;
    setOpen(false);
    navigate(`/inbox?conversation=${id}`);
    if (item.unread) await markConversationRead(id);
  };

  return <div className="relative" ref={containerRef}>
    <Button variant="ghost" size="icon" aria-label="Notificações" onClick={() => setOpen((value) => !value)}>
      <Bell className="h-4.5 w-4.5" />
      {unreadContacts > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--color-error)] px-1 text-[10px] font-bold text-white">{unreadContacts > 99 ? '99+' : unreadContacts}</span>}
    </Button>
    {open && <div className="absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[340px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-[rgba(59,130,246,0.25)] bg-[var(--color-bg-elevated)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[rgba(59,130,246,0.12)] p-3">
        <div><div className="text-label">Conversas recentes</div><div className="text-xs text-[var(--color-text-secondary)]">{unreadContacts} contatos não lidos</div></div>
        {unreadContacts > 0 && <Button size="sm" variant="ghost" onClick={() => void markAllRead()}><CheckCheck className="h-3.5 w-3.5" />Marcar todas</Button>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {sections.length === 0 ? <div className="p-8 text-center text-xs text-[var(--color-text-secondary)]">Sem notificações pendentes.</div> : sections.map((section) => <section key={section.id}>
          <h3 className="border-y border-[rgba(59,130,246,0.08)] bg-[rgba(59,130,246,0.03)] px-3 py-2 text-[10px] font-semibold uppercase text-[var(--color-text-secondary)]">{section.label}</h3>
          <ul className="divide-y divide-[rgba(59,130,246,0.08)]">
            {section.items.map((item) => {
              const n = item.latest;
              const Icon = n.type === 'handoff' ? UserRoundCog : n.type === 'sla_breach' ? AlarmClock : n.type === 'mention' ? AtSign : MessageSquare;
              const iconCls = n.type === 'sla_breach' ? 'bg-red-500/15 text-red-400' : n.type === 'handoff' ? 'bg-amber-500/15 text-amber-300' : 'bg-blue-500/15 text-[var(--accent-primary)]';
              const subtitle = n.type === 'handoff' ? 'Aguardando atendimento humano' : (n.body || 'Nova mensagem');
              return <li key={n.conversation_id ?? n.id}><button type="button" onClick={() => void openConversation(item)} className={cn('flex w-full items-center gap-3 p-3 text-left transition hover:bg-[rgba(59,130,246,0.06)]', item.unread && 'bg-[rgba(59,130,246,0.04)]')}>
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', iconCls)}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-sm text-[var(--color-text-primary)]">{contactName(n.title)}</strong><span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-secondary)]">{relativeTime(n.created_at)}</span></span><span className="block truncate text-xs text-[var(--color-text-secondary)]">{subtitle}</span></span>
              {item.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-bold text-white">{item.unread}</span>}
            </button></li>;
            })}
          </ul>
        </section>)}
      </div>
    </div>}
  </div>;
}