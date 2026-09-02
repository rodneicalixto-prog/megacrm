import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Download,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  Upload,
  Users,
  Forward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContacts, type ContactSort } from '@/hooks/useContacts';
import { useTags } from '@/hooks/useTags';
import { TagManagerDialog } from '@/components/contacts/TagManagerDialog';
import { ContactFormDialog } from '@/components/contacts/ContactFormDialog';
import { ImportContactsDialog } from '@/components/contacts/ImportContactsDialog';
import type { ContactWithTags } from '@/types/db';
import { CONTACT_SOURCE_LABEL } from '@/types/crm';
import { TRAFFIC_LABEL } from '@/lib/dashboard';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { buildContactsCsv, downloadCsv, fetchContactsForExport } from '@/lib/contactsCsv';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { getSupabase } from '@/lib/supabase';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 1000] as const;

const SOURCE_OPTIONS = ['whatsapp', 'instagram', 'import', 'manual'];

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<ContactSort>('recent');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showTagManager, setShowTagManager] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContactWithTags | null>(null);
  const [showImport, setShowImport] = useState(false);

  const { tags } = useTags();
  const { operators } = useOperators();
  const { contacts, total, loading, error, remove, assignTags, reload } = useContacts({
    search,
    tagId: tagFilter,
    source: sourceFilter,
    sort,
    page,
    pageSize,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected = useMemo(
    () => contacts.length > 0 && contacts.every((c) => selected.has(c.id)),
    [contacts, selected],
  );

  const toggleSelectAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const [bulkBusy, setBulkBusy] = useState(false);

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Remover ${selected.size} contato(s)?`)) return;
    setBulkBusy(true);
    try {
      await remove(Array.from(selected));
      toast.success(`${selected.size} contato(s) removido(s).`);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível remover os contatos.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkTag = async (tagId: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      await assignTags(Array.from(selected), [tagId]);
      const tag = tags.find((t) => t.id === tagId);
      toast.success(`Tag "${tag?.name}" aplicada a ${selected.size} contato(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível aplicar a tag.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleForward = async (operatorId: string) => {
    if (!operatorId || selected.size === 0) return;
    setBulkBusy(true);
    try {
      for (const contactId of selected) {
        const { error } = await getSupabase().schema('whatsapp_hub').rpc('forward_contact', {
          p_contact_id: contactId,
          p_to_user_id: operatorId,
        });
        if (error) throw error;
      }
      toast.success(`${selected.size} contato(s) encaminhado(s).`);
      setSelected(new Set());
    } catch (error) {
      toast.error('Não foi possível encaminhar', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBulkBusy(false);
    }
  };

  const [exportBusy, setExportBusy] = useState(false);

  const handleExport = async () => {
    setExportBusy(true);
    try {
      const ids = selected.size > 0 ? Array.from(selected) : undefined;
      const rows = await fetchContactsForExport({
        ids,
        search,
        tagId: tagFilter,
        source: sourceFilter,
        sort,
      });
      if (rows.length === 0) {
        toast.error('Nenhum contato para exportar.');
        return;
      }
      const csv = buildContactsCsv(rows);
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(`contatos-${today}.csv`, csv);
      toast.success(`${rows.length} contato(s) exportado(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível exportar os contatos.');
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <Users className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">Contatos</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {total.toLocaleString('pt-BR')} contato{total !== 1 ? 's' : ''} no total
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowTagManager(true)}>
            <TagIcon className="h-4 w-4" />
            Tags
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4" />
            Importar
          </Button>
          <Button variant="outline" onClick={() => void handleExport()} disabled={exportBusy}>
            <Download className="h-4 w-4" />
            {selected.size > 0 ? `Exportar selecionados (${selected.size})` : 'Exportar CSV'}
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Novo contato
          </Button>
        </div>
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-secondary)]" />
            <input
              type="search"
              placeholder="Buscar por nome, telefone ou e-mail"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              className="w-full h-10 pl-10 pr-4 rounded-lg bg-white/[0.03] border border-[rgba(59,130,246,0.12)] text-sm placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>
          <select
            value={tagFilter ?? ''}
            onChange={(e) => {
              setPage(1);
              setTagFilter(e.target.value || null);
            }}
            className="h-10 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">Todas as tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter ?? ''}
            onChange={(e) => {
              setPage(1);
              setSourceFilter(e.target.value || null);
            }}
            className="h-10 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">Todos os canais</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {CONTACT_SOURCE_LABEL[s] ?? s}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => {
              setPage(1);
              setSort(e.target.value as ContactSort);
            }}
            className="h-10 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)]"
          >
            <option value="recent">Mais recentes</option>
            <option value="oldest">Mais antigos</option>
            <option value="first_seen">Primeiro registro</option>
            <option value="name">Nome (A–Z)</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.06)] px-4 py-2">
            <span className="text-sm font-medium">
              {selected.size} selecionado{selected.size > 1 ? 's' : ''}
            </span>
            <div className="ml-auto flex items-center gap-1 flex-wrap">
              <label className="relative inline-flex items-center">
                <Forward className="pointer-events-none absolute left-2 h-3.5 w-3.5" />
                <select
                  aria-label="Encaminhar contatos"
                  defaultValue=""
                  disabled={bulkBusy}
                  onChange={(event) => { void handleForward(event.target.value); event.currentTarget.value = ''; }}
                  className="h-8 rounded-lg border border-[rgba(59,130,246,0.2)] bg-[var(--color-bg-elevated)] pl-7 pr-2 text-xs"
                >
                  <option value="" disabled>Encaminhar para…</option>
                  {operators.map((operator) => <option key={operator.user_id} value={operator.user_id}>{operatorLabel(operator)}</option>)}
                </select>
              </label>
              {tags.slice(0, 5).map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleBulkTag(t.id)}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                  + {t.name}
                </button>
              ))}
              <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkBusy}>
                <Trash2 className="h-3.5 w-3.5" />
                Remover
              </Button>
            </div>
          </div>
        )}

        {error && <LoadErrorBanner message={error} onRetry={() => void reload()} />}

        <div className="rounded-lg border border-[rgba(59,130,246,0.08)] overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="bg-white/[0.02] text-left">
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    className="accent-[var(--accent-primary)]"
                    aria-label="Selecionar todos da página"
                  />
                </th>
                <th className="p-3 text-label">Nome</th>
                <th className="p-3 text-label">Tipo</th>
                <th className="p-3 text-label">Telefone</th>
                <th className="p-3 text-label">Canal</th>
                <th className="p-3 text-label">Origem</th>
                <th className="p-3 text-label">Primeiro registro</th>
                <th className="p-3 text-label">Tags</th>
                <th className="p-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-[var(--color-text-secondary)] opacity-60">
                    Carregando...
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-[var(--color-text-secondary)] opacity-60">
                    {search || tagFilter
                      ? 'Nenhum contato encontrado com estes filtros.'
                      : 'Nenhum contato ainda — crie um manualmente ou importe CSV/XLSX.'}
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[rgba(59,130,246,0.06)] hover:bg-white/[0.02]"
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="accent-[var(--accent-primary)]"
                      />
                    </td>
                    <td className="p-3">
                      <Link
                        to={`/contacts/${c.id}`}
                        className="font-medium text-[var(--color-text-primary)] hover:text-[var(--accent-primary)]"
                      >
                        {c.name || <span className="opacity-40">— ver ficha</span>}
                      </Link>
                    </td>
                    <td className="p-3">
                      {c.kind === 'cliente' ? (
                        <span className="inline-flex rounded-full bg-[rgba(16,185,129,0.12)] px-2 py-0.5 text-xs font-semibold text-[#10B981]">Cliente</span>
                      ) : c.kind === 'lead' ? (
                        <span className="inline-flex rounded-full bg-[rgba(59,130,246,0.12)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-secondary)]">Lead</span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs text-[var(--color-text-secondary)]">
                      {c.phone || <span className="opacity-40">—</span>}
                    </td>
                    <td className="p-3 text-[var(--color-text-secondary)]">
                      {c.source ? (
                        <span className="inline-flex rounded-full bg-white/5 px-2 py-0.5 text-xs">
                          {CONTACT_SOURCE_LABEL[c.source] ?? c.source}
                        </span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="p-3 text-[var(--color-text-secondary)]">
                      {c.traffic_type ? (
                        <span className="text-xs">{TRAFFIC_LABEL[c.traffic_type] ?? c.traffic_type}</span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-[var(--color-text-secondary)]">
                      {fmtDate(c.first_seen_at ?? c.created_at)}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-white/5"
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                            {t.name}
                          </span>
                        ))}
                        {c.tags.length > 3 && (
                          <span className="text-xs text-[var(--color-text-secondary)] opacity-60">
                            +{c.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(c);
                          setShowForm(true);
                        }}
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Página {page} de {pageCount}
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-8 rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.03] px-2 text-xs text-[var(--color-text-primary)]"
              aria-label="Linhas por página"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
            >
              Próxima
            </Button>
          </div>
        </div>
      </div>

      <TagManagerDialog
        open={showTagManager}
        onClose={() => setShowTagManager(false)}
      />
      <ContactFormDialog
        open={showForm}
        contact={editing}
        onClose={() => setShowForm(false)}
        onSaved={reload}
      />
      <ImportContactsDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onDone={reload}
      />

    </div>
  );
}
