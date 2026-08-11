import { useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, Smartphone, Trash2 } from 'lucide-react';

export interface DepartmentLine {
  id: string;
  department_id: string;
  position_id: string | null;
  instance: string;
  phone_number: string | null;
  label: string | null;
  server_url: string | null;
}

export interface DepartmentLineStatus {
  configured: boolean;
  connected: boolean;
  state: string | null;
  error?: string;
}

export interface DepartmentLineDraft {
  label: string;
  instance: string;
  phone: string;
  positionId: string;
  serverUrl: string;
  apiKey: string;
}

interface PositionOption { id: string; name: string }

interface Props {
  departmentId: string;
  lines: DepartmentLine[];
  positions: PositionOption[];
  availablePositions: PositionOption[];
  statuses: Record<string, DepartmentLineStatus>;
  loadingStatus: boolean;
  busy: boolean;
  draft: DepartmentLineDraft;
  destinationAvailable: boolean;
  inputClass: string;
  onRefresh: () => void;
  onDraftChange: (field: keyof DepartmentLineDraft, value: string) => void;
  onCreate: () => void;
  onDelete: (line: DepartmentLine) => void;
  onSaveCredentials: (lineId: string, credentials: { serverUrl: string; apiKey: string }) => Promise<boolean>;
}

export function DepartmentLinesSection({
  departmentId, lines, positions, availablePositions, statuses, loadingStatus,
  busy, draft, destinationAvailable, inputClass, onRefresh, onDraftChange,
  onCreate, onDelete, onSaveCredentials,
}: Props) {
  const [openCredential, setOpenCredential] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({ serverUrl: '', apiKey: '' });

  const save = async (lineId: string, value = credentials) => {
    const saved = await onSaveCredentials(lineId, value);
    if (!saved) return;
    setOpenCredential(null);
    setCredentials({ serverUrl: '', apiKey: '' });
  };

  return (
    <section className="mb-5 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-start gap-2">
        <Smartphone className="mt-0.5 h-4 w-4 text-[var(--accent-secondary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Números / linhas</h3>
          <p className="text-xs text-[var(--color-text-secondary)]">Use o nome da instância Evolution. Sem cargo, a conversa entra na fila do setor.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loadingStatus} className="ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.2)] px-3 text-xs font-medium text-[var(--color-text-primary)] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loadingStatus ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      <div className="space-y-2">
        {lines.map((line) => {
          const position = positions.find((item) => item.id === line.position_id);
          const status = statuses[line.id];
          return (
            <div key={line.id} className="rounded-lg border border-[rgba(59,130,246,0.1)] px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{line.label ?? line.phone_number ?? line.instance}</div>
                    {loadingStatus && !status ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--accent-secondary)]" /> : (
                      <span title={status?.error} className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status?.connected ? 'bg-[rgba(16,185,129,0.14)] text-[var(--color-success)]' : status ? 'bg-[rgba(239,68,68,0.12)] text-[var(--color-error)]' : 'bg-white/[0.06] text-[var(--color-text-secondary)]'}`}>
                        {status?.connected ? 'conectado' : status?.configured ? 'offline' : status ? 'não configurado' : 'não verificado'}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-[var(--color-text-secondary)]">
                    {line.phone_number ? `${line.phone_number} · ` : ''}{line.instance} · {position?.name ?? 'Fila do setor'} · {line.server_url ? 'credencial própria' : 'credencial global'}
                  </div>
                </div>
                <button type="button" onClick={() => { const open = openCredential !== line.id; setOpenCredential(open ? line.id : null); setCredentials({ serverUrl: open ? (line.server_url ?? '') : '', apiKey: '' }); }} aria-label={`Configurar credencial da linha ${line.label ?? line.instance}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--accent-secondary)]"><KeyRound className="h-4 w-4" /></button>
                <button type="button" onClick={() => onDelete(line)} aria-label={`Remover linha ${line.label ?? line.instance}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"><Trash2 className="h-4 w-4" /></button>
              </div>
              {openCredential === line.id ? (
                <div className="mt-2 grid gap-2 border-t border-[rgba(59,130,246,0.08)] pt-3 sm:grid-cols-2">
                  <input value={credentials.serverUrl} onChange={(event) => setCredentials((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="URL Evolution própria" className={inputClass} />
                  <input type="password" autoComplete="new-password" value={credentials.apiKey} onChange={(event) => setCredentials((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Digite a chave da linha" className={inputClass} />
                  <div className="flex gap-2 sm:col-span-2 sm:justify-end">
                    <button type="button" onClick={() => void save(line.id, { serverUrl: '', apiKey: '' })} disabled={busy} className="h-9 rounded-lg px-3 text-xs text-[var(--color-text-secondary)]">Usar global</button>
                    <button type="button" onClick={() => void save(line.id)} disabled={busy || !credentials.serverUrl.trim() || !credentials.apiKey.trim()} className="h-9 rounded-lg bg-[var(--accent-primary)] px-4 text-xs font-semibold text-white disabled:opacity-40">Salvar</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {lines.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)] opacity-70">Nenhum número neste setor.</p> : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input value={draft.label} onChange={(event) => onDraftChange('label', event.target.value)} placeholder="Nome visível (opcional)" className={inputClass} />
        <input value={draft.phone} onChange={(event) => onDraftChange('phone', event.target.value)} placeholder="Telefone (opcional)" className={inputClass} />
        <input value={draft.instance} onChange={(event) => onDraftChange('instance', event.target.value)} placeholder="Instância Evolution" className={inputClass} />
        <select value={draft.positionId} onChange={(event) => onDraftChange('positionId', event.target.value)} className={inputClass}>
          <option value="">Fila do setor</option>
          {availablePositions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
        </select>
        <input value={draft.serverUrl} onChange={(event) => onDraftChange('serverUrl', event.target.value)} placeholder="URL Evolution própria (opcional)" className={inputClass} />
        <input type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => onDraftChange('apiKey', event.target.value)} placeholder="Chave da linha (opcional)" className={inputClass} />
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Deixe URL e chave vazias para usar a Evolution global. A chave própria é criptografada no servidor e nunca volta ao navegador.</p>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={onCreate} disabled={busy || !draft.instance.trim() || !destinationAvailable} className="flex h-10 items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"><Plus className="h-4 w-4" /> Adicionar número</button>
      </div>
      <span className="sr-only">Setor {departmentId}</span>
    </section>
  );
}
