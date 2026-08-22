import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Image as ImageIcon, Loader2, Trash2, Upload, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDispatchFiles } from '@/hooks/useDispatchFiles';
import type { DispatchFile } from '@/types/massDispatch';

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DispatchFilesTab() {
  const { files, loading, uploadContactList, uploadAttachment, remove } = useDispatchFiles();
  const [listName, setListName] = useState('');
  const [attachName, setAttachName] = useState('');
  const [uploadingList, setUploadingList] = useState(false);
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const listInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const contactLists = files.filter((f) => f.file_type === 'contact_list');
  const attachments = files.filter((f) => f.file_type === 'attachment');

  const handleUploadList = async (file: File) => {
    setUploadingList(true);
    try {
      const result = await uploadContactList(file, listName || file.name);
      if (result) toast.success(`Lista importada: ${result.contactCount} contatos.`);
      setListName('');
      if (listInputRef.current) listInputRef.current.value = '';
    } catch (err) {
      toast.error('Falha ao importar lista', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setUploadingList(false);
    }
  };

  const handleUploadAttachment = async (file: File) => {
    setUploadingAttach(true);
    try {
      const uploaded = await uploadAttachment(file, attachName || file.name);
      if (uploaded) toast.success('Arquivo salvo.');
      setAttachName('');
      if (attachInputRef.current) attachInputRef.current.value = '';
    } catch (err) {
      toast.error('Falha ao subir arquivo', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setUploadingAttach(false);
    }
  };

  const handleRemove = async (f: DispatchFile) => {
    if (!confirm(`Excluir "${f.name}"?`)) return;
    try {
      await remove(f);
      toast.success('Arquivo excluído.');
    } catch (err) {
      toast.error('Falha ao excluir', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-8">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Listas de contato e anexos ficam guardados aqui para reaproveitar em disparos futuros (reenvios sem reimportar).
      </p>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--accent-primary)]" />
          <h3 className="font-semibold text-[var(--color-text-primary)]">Listas de contato</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Nome da lista (opcional)" className="max-w-xs" />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2.5 text-sm font-semibold text-white">
            {uploadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar CSV/XLSX
            <input
              ref={listInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadList(f); }}
            />
          </label>
        </div>
        <div className="space-y-2">
          {contactLists.length === 0 && !loading && (
            <p className="text-sm text-[var(--color-text-secondary)] opacity-70">Nenhuma lista importada ainda.</p>
          )}
          {contactLists.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.02] px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-[var(--color-text-primary)]">{f.name}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">{(f.contact_ids ?? []).length} contatos · {formatSize(f.file_size_bytes)}</div>
              </div>
              <button onClick={() => void handleRemove(f)} className="rounded p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-[var(--accent-primary)]" />
          <h3 className="font-semibold text-[var(--color-text-primary)]">Anexos (imagens, vídeos, documentos)</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input value={attachName} onChange={(e) => setAttachName(e.target.value)} placeholder="Nome do arquivo (opcional)" className="max-w-xs" />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2.5 text-sm font-semibold text-white">
            {uploadingAttach ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Subir arquivo
            <input
              ref={attachInputRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadAttachment(f); }}
            />
          </label>
        </div>
        <div className="space-y-2">
          {attachments.length === 0 && !loading && (
            <p className="text-sm text-[var(--color-text-secondary)] opacity-70">Nenhum anexo salvo ainda.</p>
          )}
          {attachments.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.02] px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--color-text-secondary)]" />
                <div>
                  <div className="font-medium text-[var(--color-text-primary)]">{f.name}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">{f.media_type} · {formatSize(f.file_size_bytes)}</div>
                </div>
              </div>
              <button onClick={() => void handleRemove(f)} className="rounded p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
