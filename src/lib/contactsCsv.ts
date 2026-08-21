// Export CSV de contatos (RFC4180) e busca dos contatos a exportar —
// reaproveita os mesmos filtros da listagem em ContactsPage, sem paginação.
import { getSupabase } from '@/lib/supabase';
import type { ContactWithTags, Tag } from '@/types/db';
import type { ContactSort } from '@/hooks/useContacts';
import { chunkArray } from '@/lib/chunk';

const IN_CHUNK_SIZE = 100;

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

/** Compara duas linhas de `contacts` seguindo o mesmo critério do `.order()` que substitui, para reordenar client-side depois de mesclar os lotes. */
function compareContactRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  sort: ContactSort,
): number {
  if (sort === 'oldest') {
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  }
  if (sort === 'name') {
    const an = a.name as string | null;
    const bn = b.name as string | null;
    if (an == null && bn == null) return 0;
    if (an == null) return 1; // nullsFirst: false
    if (bn == null) return -1;
    return an.localeCompare(bn);
  }
  if (sort === 'first_seen') {
    return String(b.first_seen_at ?? '').localeCompare(String(a.first_seen_at ?? ''));
  }
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
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

  let rows: Record<string, unknown>[];

  if (ids && ids.length > 0) {
    // Seleção explícita da tabela — cada lote é independente, sem filtro extra.
    const chunks = chunkArray(ids, IN_CHUNK_SIZE);
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const { data, error: err } = await supabase
          .schema('whatsapp_hub')
          .from('contacts')
          .select('*')
          .in('id', chunk);
        if (err) throw new Error(err.message);
        return data ?? [];
      }),
    );
    rows = results.flat();
  } else {
    // Mesmo filtro da listagem (busca/tag/canal), sem paginação. Quando há tag,
    // fatia contactIdsForTag em lotes — os demais filtros (source/search) vão
    // junto em cada lote, e a ordenação final é refeita client-side depois do
    // merge, já que ela não é preservada por múltiplas queries em paralelo.
    const runQuery = async (idChunk: string[] | null) => {
      let query = supabase.schema('whatsapp_hub').from('contacts').select('*');
      if (idChunk) query = query.in('id', idChunk);
      if (source) query = query.eq('source', source);
      if (search.trim()) {
        const pattern = `%${search.trim()}%`;
        query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`);
      }
      const { data, error: err } = await query;
      if (err) throw new Error(err.message);
      return data ?? [];
    };

    if (contactIdsForTag) {
      const chunks = chunkArray(contactIdsForTag, IN_CHUNK_SIZE);
      const results = await Promise.all(chunks.map((chunk) => runQuery(chunk)));
      rows = results.flat();
    } else {
      rows = await runQuery(null);
    }
    rows.sort((a, b) => compareContactRows(a, b, sort));
  }

  if (rows.length === 0) return [];

  const rowIds = rows.map((c) => c.id as string);
  const idChunks = chunkArray(rowIds, IN_CHUNK_SIZE);
  const linkResults = await Promise.all(
    idChunks.map(async (chunk) => {
      const { data, error: linkErr } = await supabase
        .schema('whatsapp_hub')
        .from('contact_tags')
        .select('contact_id, tag:tag_id(id, name, color, created_at, updated_at)')
        .in('contact_id', chunk);
      if (linkErr) throw new Error(linkErr.message);
      return data ?? [];
    }),
  );
  const linkRows = linkResults.flat();

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
    ...(c as unknown as ContactWithTags),
    tags: byContact.get(c.id as string) ?? [],
  }));
}
