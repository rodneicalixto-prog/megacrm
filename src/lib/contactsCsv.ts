// Export CSV de contatos (RFC4180) e busca dos contatos a exportar —
// reaproveita os mesmos filtros da listagem em ContactsPage, sem paginação.
import { getSupabase } from '@/lib/supabase';
import type { ContactWithTags, Tag } from '@/types/db';
import type { ContactSort } from '@/hooks/useContacts';

const CSV_HEADERS = ['nome', 'telefone', 'email', 'tags', 'origem'];

/** Escapa um campo para CSV RFC4180: entre aspas se houver vírgula, aspas ou quebra de linha. */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

/** Monta o conteúdo CSV (com cabeçalho) a partir de uma lista de contatos. */
export function buildContactsCsv(contacts: ContactWithTags[]): string {
  const lines = [toCsvRow(CSV_HEADERS)];
  for (const c of contacts) {
    lines.push(
      toCsvRow([
        c.name ?? '',
        c.phone ?? '',
        c.email ?? '',
        c.tags.map((t) => t.name).join(', '),
        c.source ?? '',
      ]),
    );
  }
  return lines.join('\r\n');
}

/** Dispara o download de um arquivo CSV no browser via Blob + link temporário. */
export function downloadCsv(filename: string, csvContent: string): void {
  // BOM UTF-8 na frente para o Excel reconhecer acentuação corretamente.
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface FetchContactsForExportInput {
  /** Quando presente, exporta só estes ids (seleção) — ignora os demais filtros. */
  ids?: string[];
  search?: string;
  tagId?: string | null;
  source?: string | null;
  sort?: ContactSort;
}

/**
 * Busca os contatos para exportação: por ids (seleção da tabela) ou pelo
 * mesmo filtro da listagem (busca/tag/canal/ordenação), sem paginação —
 * traz todas as linhas que casam com o filtro ativo, não só a página atual.
 */
export async function fetchContactsForExport({
  ids,
  search = '',
  tagId = null,
  source = null,
  sort = 'recent',
}: FetchContactsForExportInput): Promise<ContactWithTags[]> {
  const supabase = getSupabase();

  let contactIdsForTag: string[] | null = null;
  if (!ids && tagId) {
    const { data: links, error: linksErr } = await supabase
      .schema('whatsapp_hub')
      .from('contact_tags')
      .select('contact_id')
      .eq('tag_id', tagId);
    if (linksErr) throw new Error(linksErr.message);
    contactIdsForTag = (links ?? []).map((l) => l.contact_id as string);
    if (contactIdsForTag.length === 0) return [];
  }

  let query = supabase.schema('whatsapp_hub').from('contacts').select('*');

  if (ids && ids.length > 0) {
    query = query.in('id', ids);
  } else {
    if (sort === 'oldest') query = query.order('created_at', { ascending: true });
    else if (sort === 'name') query = query.order('name', { ascending: true, nullsFirst: false });
    else if (sort === 'first_seen') query = query.order('first_seen_at', { ascending: false });
    else query = query.order('created_at', { ascending: false });

    if (contactIdsForTag) query = query.in('id', contactIdsForTag);
    if (source) query = query.eq('source', source);
    if (search.trim()) {
      const pattern = `%${search.trim()}%`;
      query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`);
    }
  }

  const { data, error: err } = await query;
  if (err) throw new Error(err.message);

  const rows = data ?? [];
  const rowIds = rows.map((c) => c.id as string);
  if (rowIds.length === 0) return [];

  const { data: linkRows, error: linkErr } = await supabase
    .schema('whatsapp_hub')
    .from('contact_tags')
    .select('contact_id, tag:tag_id(id, name, color, created_at, updated_at)')
    .in('contact_id', rowIds);
  if (linkErr) throw new Error(linkErr.message);

  const byContact = new Map<string, Tag[]>();
  for (const row of linkRows ?? []) {
    const contactId = row.contact_id as string;
    const tag = row.tag as unknown as Tag | null;
    if (!tag) continue;
    const arr = byContact.get(contactId) ?? [];
    arr.push(tag);
    byContact.set(contactId, arr);
  }

  return rows.map((c) => ({
    ...(c as ContactWithTags),
    tags: byContact.get(c.id as string) ?? [],
  }));
}
