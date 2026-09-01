import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Slash, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuickReplies } from '@/hooks/useQuickReplies';

// Configurações → Respostas rápidas. Atalhos compartilhados por toda a
// instância; qualquer um com can_operate() pode criar, mas só o autor (ou
// admin+) edita/apaga o de outra pessoa — ver RLS em
// 20260823120000_quick_replies_search_mentions.sql.
export function QuickRepliesSettings() {
  const { quickReplies, loading, create, remove } = useQuickReplies();
  const [shortcut, setShortcut] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const addQuickReply = async () => {
    const cleanShortcut = shortcut.trim().toLowerCase().replace(/^\//, '');
    const trimmedContent = content.trim();
    if (!cleanShortcut || !trimmedContent) {
      toast.error('Informe o atalho e o texto da resposta.');
      return;
    }
    if (!/^[a-z0-9_-]{1,40}$/.test(cleanShortcut)) {
      toast.error('Atalho inválido', { description: 'Use apenas letras minúsculas, números, - e _ (sem espaços).' });
      return;
    }
    setSaving(true);
    const res = await create(cleanShortcut, trimmedContent);
    setSaving(false);
    if (!res.ok) {
      const msg = /duplicate|unique/i.test(res.error ?? '') ? 'Já existe um atalho com esse nome.' : res.error;
      toast.error('Falha ao cadastrar', { description: msg });
      return;
    }
    toast.success('Resposta rápida cadastrada.');
    setShortcut('');
    setContent('');
  };

  const removeQuickReply = async (id: string, label: string) => {
    if (!confirm(`Remover a resposta rápida "/${label}"?`)) return;
    const res = await remove(id);
    if (!res.ok) toast.error('Falha ao remover', { description: res.error });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <div className="text-label">Respostas rápidas</div>
        <h2 className="text-xl font-bold text-display">Atalhos do Inbox</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Digite <code>/atalho</code> no campo de mensagem do Inbox pra abrir o
          autocomplete e inserir o texto abaixo — ele pode ser editado antes de
          enviar.
        </p>
      </header>

      <div className="glass-card space-y-3 p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
          <Input
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="saudacao"
          />
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Olá! Em que posso ajudar hoje?"
          />
          <Button type="button" onClick={addQuickReply} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Cadastrar
          </Button>
        </div>
      </div>

      <div className="glass-card p-4">
        {loading ? (
          <div className="py-8 text-center text-label opacity-60">Carregando...</div>
        ) : quickReplies.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-secondary)] opacity-60">
            Nenhuma resposta rápida cadastrada ainda.
          </div>
        ) : (
          <div className="space-y-1.5">
            {quickReplies.map((qr) => (
              <div
                key={qr.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgba(59,130,246,0.08)] bg-white/[0.02] px-3 py-2"
              >
                <Slash className="h-4 w-4 shrink-0 text-[var(--accent-secondary)]" />
                <span className="shrink-0 text-sm font-semibold text-[var(--accent-primary)]">/{qr.shortcut}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-secondary)]">{qr.content}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeQuickReply(qr.id, qr.shortcut)}
                  aria-label="Remover resposta rápida"
                >
                  <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
