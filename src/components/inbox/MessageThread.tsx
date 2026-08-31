import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, CheckCheck, ChevronDown, ChevronUp, Clock, FileText, Forward, Reply, Search, SmilePlus, StickyNote, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase';
import type { Message } from '@/types/inbox';
import type { ThreadMessage } from '@/hooks/useMessages';

interface MessageThreadProps {
  messages: ThreadMessage[];
  loading: boolean;
  onRetry?: (tempId: string) => void;
  onDismiss?: (tempId: string) => void;
  onForward?: (message: ThreadMessage) => void;
  onReply?: (message: ThreadMessage) => void;
  onReact?: (message: ThreadMessage, emoji: string) => void;
}

function StatusTicks({ status }: { status: Message['meta_status'] }) {
  if (!status) return null;
  if (status === 'failed') return <span className="text-[var(--color-error)] text-[10px]">falhou</span>;
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-[#3B82F6]" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 opacity-60" />;
  return <Check className="h-3 w-3 opacity-60" />;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Agrupa por emoji (contato, dono pelo celular e operador via CRM podem
// reagir à mesma mensagem com o mesmo emoji) só para exibir "emoji ×N".
function groupReactions(reactions: ThreadMessage['reactions']): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  return [...counts.entries()];
}

function ReactionBadges({ reactions }: { reactions: ThreadMessage['reactions'] }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groupReactions(reactions).map(([emoji, count]) => (
        <span
          key={emoji}
          className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-card)] px-1.5 py-0.5 text-xs leading-none"
        >
          {emoji}
          {count > 1 && <span className="text-[10px] text-[var(--color-text-secondary)]">{count}</span>}
        </span>
      ))}
    </div>
  );
}

// Chave de dia local (não UTC) para agrupar mensagens por data de calendário.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDaySeparator(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoje';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Ontem';

  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="text-label rounded-full bg-[rgba(59,130,246,0.08)] px-3 py-1 text-[var(--text-secondary)]">
        {formatDaySeparator(iso)}
      </span>
    </div>
  );
}

function SenderIcon({ sender }: { sender: Message['sender_type'] }) {
  if (sender === 'ai') return <Bot className="h-3.5 w-3.5" />;
  if (sender === 'operator') return <User className="h-3.5 w-3.5" />;
  return null;
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
};

const MEDIA_RECEIVED: Record<string, string> = {
  image: 'Imagem recebida',
  audio: 'Áudio recebido',
  video: 'Vídeo recebido',
  document: 'Documento recebido',
};

function RepairableAudio({ message }: { message: Message }) {
  const [url, setUrl] = useState(message.media_url ?? '');
  const [repairState, setRepairState] = useState<'idle' | 'loading' | 'error'>('idle');
  const attempted = useRef(false);
  const canRepair = message.direction === 'inbound';

  const repair = useCallback(async () => {
    if (!canRepair || attempted.current) return;
    attempted.current = true;
    setRepairState('loading');
    try {
      const { data, error } = await getSupabase().functions.invoke('resolve-inbound-media', {
        body: { message_id: message.id },
      });
      if (error) throw error;
      const mediaUrl = typeof data?.media_url === 'string' ? data.media_url : '';
      if (!mediaUrl) throw new Error('URL do áudio não foi devolvida.');
      setUrl(mediaUrl);
      setRepairState('idle');
    } catch {
      setRepairState('error');
    }
  }, [canRepair, message.id]);

  const detectInvalidAudio = (audio: HTMLAudioElement) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) void repair();
  };

  return (
    <div className="space-y-1.5">
      <audio
        key={url}
        controls
        preload="metadata"
        src={url}
        className="max-w-full"
        onError={() => void repair()}
        onLoadedMetadata={(event) => detectInvalidAudio(event.currentTarget)}
      />
      {repairState === 'loading' && (
        <div className="text-[10px] opacity-70">Preparando áudio...</div>
      )}
      {repairState === 'error' && (
        <button
          type="button"
          className="text-[11px] font-semibold underline"
          onClick={() => {
            attempted.current = false;
            void repair();
          }}
        >
          Tentar carregar áudio
        </button>
      )}
    </div>
  );
}

// Renderiza mídia quando `media_url` já é uma URL http(s). No modelo Zernio,
// tanto a mídia inbound (URL do attachment no webhook) quanto a outbound do
// operador (URL do /media/upload-direct) chegam já como URL — o placeholder
// abaixo só aparece em linhas antigas sem URL resolvida.
function MediaContent({ message }: { message: Message }) {
  const url = message.media_url ?? '';
  const isHttp = /^https?:\/\//i.test(url);
  const label = MEDIA_LABEL[message.content_type] ?? 'Mídia';
  const caption = message.content?.trim();

  if (isHttp) {
    if (message.content_type === 'image') {
      return (
        <div className="space-y-1">
          <img src={url} alt={caption || label} className="max-h-64 rounded-lg" loading="lazy" />
          {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
        </div>
      );
    }
    if (message.content_type === 'audio') {
      return <RepairableAudio message={message} />;
    }
    if (message.content_type === 'video') {
      return <video controls src={url} className="max-h-64 rounded-lg" />;
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">
        {caption || `Abrir ${label.toLowerCase()}`}
      </a>
    );
  }

  // Sem URL resolvida — placeholder informativo (ver débito técnico: pipeline
  // de download de mídia da Meta ainda não implementado).
  const received = MEDIA_RECEIVED[message.content_type] ?? 'Mídia recebida';
  return (
    <div className="italic opacity-80">
      {received}
      {caption ? `: ${caption}` : ' — visualização indisponível nesta versão.'}
    </div>
  );
}

function FailedActions({
  tempId,
  onRetry,
  onDismiss,
  inverse,
}: {
  tempId: string;
  onRetry?: (tempId: string) => void;
  onDismiss?: (tempId: string) => void;
  inverse?: boolean;
}) {
  // inverse=true → dentro do balão azul (texto claro); senão card claro.
  const base = inverse ? 'text-white/90' : 'text-[var(--color-error)]';
  return (
    <div className={cn('mt-1 flex items-center gap-2 text-[10px]', base)}>
      <span className="font-semibold">Não enviou.</span>
      <button type="button" onClick={() => onRetry?.(tempId)} className="underline hover:opacity-80">
        Reenviar
      </button>
      <button type="button" onClick={() => onDismiss?.(tempId)} className="underline opacity-70 hover:opacity-100">
        Descartar
      </button>
    </div>
  );
}

function MessageActions({ message, onForward, onReply, onReact }: {
  message: ThreadMessage;
  onForward?: (message: ThreadMessage) => void;
  onReply?: (message: ThreadMessage) => void;
  onReact?: (message: ThreadMessage, emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="relative mb-2 flex items-center gap-0.5 opacity-0 transition group-hover/message:opacity-100 focus-within:opacity-100">
    <button type="button" onClick={() => onReply?.(message)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5" title="Responder"><Reply className="h-3.5 w-3.5" /></button>
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5" title="Reagir"><SmilePlus className="h-3.5 w-3.5" /></button>
    <button type="button" onClick={() => onForward?.(message)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5" title="Encaminhar"><Forward className="h-3.5 w-3.5" /></button>
    {open && <div className="absolute bottom-9 left-0 z-20 flex gap-1 rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-elevated)] p-1 shadow-xl">
      {['👍','❤️','😂','😮','😢','🙏'].map((emoji) => <button key={emoji} type="button" className="flex h-8 w-8 items-center justify-center rounded hover:bg-white/10" onClick={() => { onReact?.(message, emoji); setOpen(false); }}>{emoji}</button>)}
    </div>}
  </div>;
}

export function MessageThread({ messages, loading, onRetry, onDismiss, onForward, onReply, onReact }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>());

  // Busca dentro da conversa — filtra o que já está carregado em memória
  // (useMessages traz o histórico inteiro da conversa, sem paginação).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);

  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => (m.content ?? '').toLowerCase().includes(q));
  }, [messages, searchQuery]);

  useEffect(() => {
    setActiveMatch(0);
  }, [searchQuery]);

  const scrollToMatch = useCallback((index: number) => {
    const match = matches[index];
    if (!match) return;
    bubbleRefs.current.get(match.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [matches]);

  useEffect(() => {
    if (matches.length > 0) scrollToMatch(activeMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch, searchQuery]);

  const goToMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    setActiveMatch((i) => (i + dir + matches.length) % matches.length);
  };

  const activeMatchId = matches[activeMatch]?.id;

  // Marca, por mensagem, se ela é a primeira do seu grupo de dia (local time)
  // — usado para inserir o separador "Hoje" / "Ontem" / data antes dela.
  const dayBreaks = useMemo(() => {
    const breaks = new Set<string>();
    let lastKey: string | null = null;
    for (const m of messages) {
      const key = dayKey(m.created_at);
      if (key !== lastKey) {
        breaks.add(m.id);
        lastKey = key;
      }
    }
    return breaks;
  }, [messages]);

  useEffect(() => {
    // Auto-scroll to newest message. Setting block to 'end' and using a ref
    // target below the last bubble avoids fighting with user scroll-up.
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-label opacity-60">Carregando mensagens...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-label opacity-60">Nenhuma mensagem nesta conversa.</div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="absolute right-3 top-3 z-20">
        {searchOpen ? (
          <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-elevated)] px-2 py-1.5 shadow-lg">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goToMatch(e.shiftKey ? -1 : 1);
                if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
              }}
              placeholder="Buscar na conversa…"
              className="w-40 bg-transparent text-xs text-[var(--color-text-primary)] outline-none sm:w-56"
            />
            {searchQuery.trim() && (
              <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-secondary)]">
                {matches.length > 0 ? `${activeMatch + 1}/${matches.length}` : '0/0'}
              </span>
            )}
            <button type="button" onClick={() => goToMatch(-1)} disabled={matches.length === 0} aria-label="Resultado anterior" className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => goToMatch(1)} disabled={matches.length === 0} aria-label="Próximo resultado" className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} aria-label="Fechar busca" className="rounded p-0.5 hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Buscar na conversa"
            title="Buscar na conversa"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-card)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shadow-lg hover:text-[var(--color-text-primary)]"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>
    <div className="flex-1 overflow-y-auto p-6 space-y-3">
      {messages.map((m) => {
        const isNote = m.is_private_note;
        const isInbound = m.direction === 'inbound';
        const showDaySeparator = dayBreaks.has(m.id);

        if (isNote) {
          // Internal note — no bubble alignment; full-width yellow-tinted card.
          return (
            <div key={m.id} className="contents">
              {showDaySeparator && <DaySeparator iso={m.created_at} />}
              <div
                ref={(el) => { if (el) bubbleRefs.current.set(m.id, el); else bubbleRefs.current.delete(m.id); }}
                className={cn(
                  'mx-auto max-w-[85%] rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] p-3',
                  m._state === 'pending' && 'opacity-70',
                  activeMatchId === m.id && 'ring-2 ring-[var(--accent-primary)]',
                )}
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#FBBF24] mb-1">
                  <StickyNote className="h-3 w-3" />
                  Nota privada entre operadores
                  <span className="ml-auto opacity-70 inline-flex items-center gap-1">
                    {m._state === 'pending' && <Clock className="h-3 w-3 animate-pulse" />}
                    {formatTime(m.created_at)}
                  </span>
                </div>
                <div className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
                  {m.content}
                </div>
                {m._state === 'failed' && m._tempId && (
                  <FailedActions tempId={m._tempId} onRetry={onRetry} onDismiss={onDismiss} />
                )}
              </div>
            </div>
          );
        }

        return (
          <div key={m.id} className="contents">
            {showDaySeparator && <DaySeparator iso={m.created_at} />}
            <div
              className={cn('group/message flex items-end gap-1', isInbound ? 'justify-start' : 'justify-end')}
            >
              {!isInbound && (
                <MessageActions message={m} onForward={onForward} onReply={onReply} onReact={onReact} />
              )}
              <div
                ref={(el) => { if (el) bubbleRefs.current.set(m.id, el); else bubbleRefs.current.delete(m.id); }}
                className={cn(
                  'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-opacity',
                  isInbound
                    ? 'bg-white/[0.04] text-[var(--color-text-primary)] rounded-bl-md'
                    : 'bg-[var(--accent-primary)] text-white rounded-br-md',
                  m._state === 'pending' && 'opacity-70',
                  m._state === 'failed' && 'ring-1 ring-[var(--color-error)]',
                  activeMatchId === m.id && 'ring-2 ring-offset-2 ring-offset-[var(--bg-primary)] ring-[#FBBF24]',
                )}
              >
                {!isInbound && m.sender_type !== 'contact' && (
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70 mb-1">
                    <SenderIcon sender={m.sender_type} />
                    {m.sender_type === 'ai' ? 'IA' : 'Operador'}
                  </div>
                )}
                {m.reply_preview && (
                  <div className="mb-2 rounded border-l-2 border-current bg-black/10 px-2 py-1 text-xs opacity-75 line-clamp-2">
                    {m.reply_preview}
                  </div>
                )}
                {m.content_type === 'text' || m.content_type === 'note' ? (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                ) : m.content_type === 'template' ? (
                  // Template é texto renderizado (body com variáveis já substituídas),
                  // não mídia — exibe o conteúdo com um rótulo discreto de template.
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
                      <FileText className="h-3 w-3" />
                      Template
                    </div>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                ) : (
                  <MediaContent message={m} />
                )}
                <div
                  className={cn(
                    'flex items-center gap-1 text-[10px] mt-1 opacity-70',
                    isInbound ? 'justify-start' : 'justify-end',
                  )}
                >
                  <span>{formatTime(m.created_at)}</span>
                  {!isInbound && m._state === 'pending' && (
                    <Clock className="h-3 w-3 animate-pulse" aria-label="enviando" />
                  )}
                  {!isInbound && m._state !== 'pending' && m._state !== 'failed' && (
                    <StatusTicks status={m.meta_status} />
                  )}
                </div>
                <ReactionBadges reactions={m.reactions} />
                {m._state === 'failed' && m._tempId && (
                  <FailedActions tempId={m._tempId} onRetry={onRetry} onDismiss={onDismiss} inverse />
                )}
              </div>
              {isInbound && (
                <MessageActions message={m} onForward={onForward} onReply={onReply} onReact={onReact} />
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
    </div>
  );
}
