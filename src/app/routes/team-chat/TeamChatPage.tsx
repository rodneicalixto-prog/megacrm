import { useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Send, MessageCircle } from 'lucide-react';
import { operatorLabel, useOperators, type Operator } from '@/hooks/useOperators';
import { useInternalConversations, useInternalMessages } from '@/hooks/useInternalChat';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { Avatar } from '@/components/ui/Avatar';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Chat interno: DM 1:1 entre usuários da instância, sem relação com contatos
// nem departamentos — qualquer membro fala com qualquer outro. Reaproveita a
// presença já existente (app_users.is_online) em vez de criar um mecanismo
// próprio.
export function TeamChatPage() {
  const { userId } = useAppUser();
  const { operators, loading: loadingOperators } = useOperators();
  const { conversations, openWith } = useInternalConversations();
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [opening, setOpening] = useState(false);
  const { messages, send } = useInternalMessages(activeConversationId);
  const listEndRef = useRef<HTMLDivElement>(null);

  const contatos = useMemo(
    () => operators.filter((o) => o.user_id !== userId),
    [operators, userId],
  );

  const unreadByPeer = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const c of conversations) map.set(c.peer_id, c.unread);
    return map;
  }, [conversations]);

  const lastMessageByPeer = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of conversations) map.set(c.peer_id, c.last_message_at);
    return map;
  }, [conversations]);

  const activePeer = contatos.find((o) => o.user_id === activePeerId) ?? null;

  const abrirConversa = async (peer: Operator) => {
    setActivePeerId(peer.user_id);
    setOpening(true);
    const id = await openWith(peer.user_id);
    setActiveConversationId(id);
    setOpening(false);
    requestAnimationFrame(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const ok = await send(text);
    if (!ok) {
      setDraft(text);
      toast.error('Falha ao enviar mensagem. Tente novamente.');
      return;
    }
    requestAnimationFrame(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-4">
      <aside className="glass-card w-72 shrink-0 overflow-y-auto p-3">
        <div className="mb-2 flex items-center gap-2 px-2">
          <MessageCircle className="h-4 w-4 text-[var(--accent-primary)]" />
          <h2 className="text-sm font-bold text-[var(--color-text-primary)]">Contatos internos</h2>
        </div>
        {loadingOperators && (
          <p className="px-2 text-sm text-[var(--color-text-secondary)] opacity-60">Carregando…</p>
        )}
        <div className="space-y-1">
          {contatos.map((o) => {
            const unread = unreadByPeer.get(o.user_id) ?? false;
            const lastAt = lastMessageByPeer.get(o.user_id) ?? null;
            const ativo = o.user_id === activePeerId;
            return (
              <button
                key={o.user_id}
                type="button"
                onClick={() => void abrirConversa(o)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                  ativo ? 'bg-[rgba(59,130,246,0.12)]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className="relative shrink-0">
                  <Avatar name={operatorLabel(o)} size="sm" />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-bg-primary)] ${
                      o.is_online ? 'bg-[#10B981]' : 'bg-[var(--color-text-secondary)]'
                    }`}
                    title={o.is_online ? 'Online' : 'Offline'}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${unread ? 'font-bold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-primary)]'}`}>
                    {o.full_name?.trim() || o.email}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-text-secondary)]">
                    {o.department_name ?? '—'}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {lastAt && <span className="text-[10px] text-[var(--color-text-secondary)]">{timeLabel(lastAt)}</span>}
                  {unread && <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />}
                </span>
              </button>
            );
          })}
          {!loadingOperators && contatos.length === 0 && (
            <p className="px-2 text-sm text-[var(--color-text-secondary)] opacity-60">
              Nenhum outro membro na instância ainda.
            </p>
          )}
        </div>
      </aside>

      <section className="glass-card flex min-w-0 flex-1 flex-col">
        {!activePeer ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[var(--color-text-secondary)]">
            <MessageCircle className="h-8 w-8 opacity-40" />
            <p className="text-sm">Escolha um contato para conversar.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2.5 border-b border-[rgba(59,130,246,0.08)] px-4 py-3">
              <Avatar name={operatorLabel(activePeer)} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {activePeer.full_name?.trim() || activePeer.email}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {activePeer.is_online ? 'Online' : 'Offline'}
                </p>
              </div>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {opening && (
                <p className="text-center text-sm text-[var(--color-text-secondary)] opacity-60">Carregando…</p>
              )}
              {messages.map((m) => {
                const mine = m.sender_id === userId;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
                        mine
                          ? 'bg-[var(--accent-primary)] text-white'
                          : 'bg-white/[0.06] text-[var(--color-text-primary)]'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-[var(--color-text-secondary)]'}`}>
                        {timeLabel(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={listEndRef} />
            </div>

            <form onSubmit={enviar} className="flex items-center gap-2 border-t border-[rgba(59,130,246,0.08)] p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escreva uma mensagem…"
                className="h-10 flex-1 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-primary)] text-white disabled:opacity-40"
                aria-label="Enviar"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export default TeamChatPage;
