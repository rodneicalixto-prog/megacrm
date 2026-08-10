import {
  Archive,
  CheckCircle2,
  Clock,
  Inbox as InboxIcon,
  MailOpen,
  MessageSquareDot,
  Star,
  TriangleAlert,
  UserCheck,
  UserX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationWithContact } from '@/types/inbox';
import {
  QUEUES,
  matchesNonQueueFilters,
  matchesQueue,
  type InboxFilterState,
  type QueueId,
} from './inbox-filters';

const ICONS: Record<QueueId, typeof InboxIcon> = {
  todos: InboxIcon,
  nao_atribuidos: UserX,
  meus: UserCheck,
  aguardando: Clock,
  em_atendimento: MessageSquareDot,
  aguardando_cliente: MailOpen,
  encerrados: CheckCircle2,
  prioridade_alta: TriangleAlert,
  nao_lidos: Archive,
  favoritos: Star,
};

interface Props {
  conversations: ConversationWithContact[];
  filters: InboxFilterState;
  onChange: (next: QueueId) => void;
  userId: string | null;
}

// Coluna de filas. A contagem sai das MESMAS conversas já carregadas e do
// mesmo predicado que filtra a lista — um contador com regra própria
// divergiria do conteúdo na primeira mudança de definição.
export function QueueSidebar({ conversations, filters, onChange, userId }: Props) {
  const now = Date.now();
  // Pré-filtra pelos eixos que NÃO são a fila, para o número no badge ser
  // exatamente o tamanho da lista que aquele clique abre.
  const pool = conversations.filter((c) => matchesNonQueueFilters(c, filters, now));
  const value = filters.queue;
  return (
    <nav aria-label="Filas de atendimento" className="flex flex-col gap-0.5 p-2">
      {QUEUES.map((q) => {
        const Icon = ICONS[q.id];
        const count = pool.filter((c) => matchesQueue(c, q.id, userId)).length;
        const active = value === q.id;
        const urgent = q.id === 'prioridade_alta' || q.id === 'nao_lidos';
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onChange(q.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              active
                ? 'bg-[rgba(59,130,246,0.15)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]',
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                active ? 'text-[var(--accent-secondary)]' : 'text-[var(--color-text-secondary)]',
              )}
            />
            <span className="min-w-0 flex-1 truncate">{q.label}</span>
            {count > 0 ? (
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  urgent
                    ? 'bg-[rgba(239,68,68,0.15)] text-[#EF4444]'
                    : 'bg-[rgba(59,130,246,0.15)] text-[var(--accent-secondary)]',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
