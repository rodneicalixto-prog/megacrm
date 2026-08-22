import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { chunkArray } from '@/lib/chunk';
import { normalizePhone } from '@/lib/phone';
import type { DispatchFile } from '@/types/massDispatch';

const BUCKET = 'whatsapp-hub-dispatch-files';
const IN_FILTER_CHUNK_SIZE = 100;

interface UseDispatchFilesResult {
  files: DispatchFile[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  uploadContactList: (file: File, name: string) => Promise<{ contactCount: number } | null>;
  uploadAttachment: (file: File, name: string) => Promise<DispatchFile | null>;
  remove: (file: DispatchFile) => Promise<void>;
}

async function readSpreadsheet(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
}

// Coluna 0 = telefone, coluna 1 (opcional) = nome. Primeira linha só conta
// como cabeçalho se a coluna 0 não parecer telefone (heurística simples,
// mesma família da usada em ImportContactsDialog.tsx).
function looksLikePhone(v: string): boolean {
  return /\d{6,}/.test(v.replace(/\D/g, ''));
}

export function useDispatchFiles(): UseDispatchFilesResult {
  const { userId } = useAppUser();
  const [files, setFiles] = useState<DispatchFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from('mass_dispatch_files')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setFiles((data ?? []) as DispatchFile[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const uploadContactList: UseDispatchFilesResult['uploadContactList'] = async (file, name) => {
    const supabase = getSupabase();
    const rows = await readSpreadsheet(file);
    if (rows.length === 0) throw new Error('Arquivo vazio.');

    const startIdx = rows[0][0] && looksLikePhone(rows[0][0]) ? 0 : 1;
    const parsed = rows
      .slice(startIdx)
      .map((r) => {
        const result = normalizePhone(r[0] ?? '');
        return result.ok ? { phone: result.e164, name: (r[1] ?? '').trim() || null } : null;
      })
      .filter((r): r is { phone: string; name: string | null } => r !== null);
    if (parsed.length === 0) throw new Error('Nenhum telefone válido encontrado no arquivo.');

    // Find-or-create por telefone, em lotes (mesmo padrão do resto do app).
    const phones = Array.from(new Set(parsed.map((p) => p.phone)));
    const existingByPhone = new Map<string, string>();
    for (const part of chunkArray(phones, IN_FILTER_CHUNK_SIZE)) {
      const { data, error: selErr } = await supabase
        .schema('whatsapp_hub')
        .from('contacts')
        .select('id, phone')
        .in('phone', part);
      if (selErr) throw new Error(selErr.message);
      for (const row of (data ?? []) as Array<{ id: string; phone: string }>) {
        existingByPhone.set(row.phone, row.id);
      }
    }

    const missing = parsed.filter((p) => !existingByPhone.has(p.phone));
    if (missing.length > 0) {
      for (const part of chunkArray(missing, 500)) {
        const { data, error: insErr } = await supabase
          .schema('whatsapp_hub')
          .from('contacts')
          .insert(part.map((p) => ({ phone: p.phone, name: p.name, source: 'import' })))
          .select('id, phone');
        if (insErr) throw new Error(insErr.message);
        for (const row of (data ?? []) as Array<{ id: string; phone: string }>) {
          existingByPhone.set(row.phone, row.id);
        }
      }
    }

    const contactIds = Array.from(new Set(phones.map((p) => existingByPhone.get(p)).filter((id): id is string => Boolean(id))));

    const ext = (file.name.split('.').pop() || 'csv').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `contact-lists/${crypto.randomUUID()}.${ext}`;
    await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'text/csv', upsert: false });

    const { error: fileErr } = await supabase.schema('whatsapp_hub').from('mass_dispatch_files').insert({
      name: name.trim() || file.name,
      file_type: 'contact_list',
      storage_path: path,
      file_size_bytes: file.size,
      contact_ids: contactIds,
    });
    if (fileErr) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(fileErr.message);
    }

    await reload();
    return { contactCount: contactIds.length };
  };

  const uploadAttachment: UseDispatchFilesResult['uploadAttachment'] = async (file, name) => {
    const supabase = getSupabase();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `attachments/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) throw new Error(upErr.message);

    const mediaType = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'document';

    const { data, error: insErr } = await supabase
      .schema('whatsapp_hub')
      .from('mass_dispatch_files')
      .insert({
        name: name.trim() || file.name,
        file_type: 'attachment',
        storage_path: path,
        media_type: mediaType,
        file_size_bytes: file.size,
      })
      .select()
      .single();
    if (insErr || !data) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(insErr?.message ?? 'Falha ao salvar arquivo.');
    }

    await reload();
    return data as DispatchFile;
  };

  const remove: UseDispatchFilesResult['remove'] = async (file) => {
    const supabase = getSupabase();
    await supabase.storage.from(BUCKET).remove([file.storage_path]);
    const { error: err } = await supabase.schema('whatsapp_hub').from('mass_dispatch_files').delete().eq('id', file.id);
    if (err) throw new Error(err.message);
    await reload();
  };

  return { files, loading, error, reload, uploadContactList, uploadAttachment, remove };
}

export function dispatchFilePublicUrl(file: DispatchFile): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(file.storage_path).data.publicUrl;
}
