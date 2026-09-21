import { Smartphone, QrCode, KeyRound, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';

interface Linha {
  id: string;
  department_id: string;
  position_id: string | null;
  instance: string;
  phone_number: string | null;
  label: string | null;
  server_url: string | null;
}

interface Cargo {
  id: string;
  department_id: string;
  name: string;
  user_id: string | null;
}

interface LinhaStatus {
  configured: boolean;
  connected: boolean;
  state: string | null;
  error?: string;
}

interface QrDialogState {
  lineId: string;
  instance: string;
  image: string | null;
  pairingCode: string | null;
  warning: string | null;
  error: string | null;
}

interface DepartmentLinesProps {
  cargos: Cargo[];
  linhas: Linha[];
  statusLinhas: Record<string, LinhaStatus>;
  loadingStatus: boolean;
  departmentId: string;
  qrDialog: QrDialogState | null;
  qrLoading: boolean;
  onLinhasCriada: () => void;
  onCarregarStatus: () => Promise<Array<LinhaStatus & { id: string }>>;
  onQrDialogChange: (state: QrDialogState | null) => void;
  onQrLoadingChange: (loading: boolean) => void;
}

const inputCls =
  'h-10 w-full rounded-lg border border-[rgb(var(--accent-rgb)/0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[var(--color-bg-primary)] [&>option]:text-[var(--color-text-primary)]';

export function DepartmentLines({
  cargos,
  linhas,
  statusLinhas,
  loadingStatus,
  departmentId,
  onLinhasCriada,
  onCarregarStatus,
  onQrDialogChange,
  onQrLoadingChange,
}: DepartmentLinesProps) {
  const doSetor = cargos.filter((c) => c.department_id === departmentId);
  const linhasDoSetor = linhas.filter((linha) => linha.department_id === departmentId);
  const cargosSemNumero = doSetor.filter(
    (cargo) => Boolean(cargo.user_id)
      && !linhasDoSetor.some((linha) => linha.position_id === cargo.id),
  );

  const [novaLinha, setNovaLinha] = useState<{
    label: string;
    instance: string;
    phone: string;
    positionId: string;
    serverUrl: string;
    apiKey: string;
  }>({
    label: '', instance: '', phone: '', positionId: '', serverUrl: '', apiKey: '',
  });
  const [busy, setBusy] = useState(false);
  const [linhaCredencialAberta, setLinhaCredencialAberta] = useState<string | null>(null);
  const [credencialLinha, setCredencialLinha] = useState({ serverUrl: '', apiKey: '' });

  const conectarLinha = async (lineId: string, instance: string) => {
    onQrDialogChange({ lineId, instance, image: null, pairingCode: null, warning: null, error: null });
    onQrLoadingChange(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/evolution-instance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ connectionId: lineId }),
      });
      const result = await response.json() as {
        success?: boolean;
        message?: string;
        qr_image?: string | null;
        pairing_code?: string | null;
        warning?: string;
      };
      if (!response.ok || !result.success) throw new Error(result.message ?? 'Falha ao gerar QR Code.');
      onQrDialogChange({
        lineId,
        instance,
        image: result.qr_image ?? null,
        pairingCode: result.pairing_code ?? null,
        warning: result.warning ?? null,
        error: result.qr_image || result.pairing_code
          ? null
          : 'A Evolution ainda não emitiu um QR Code. Aguarde alguns segundos e gere novamente.',
      });
    } catch (connectError) {
      onQrDialogChange({
        lineId,
        instance,
        image: null,
        pairingCode: null,
        warning: null,
        error: connectError instanceof Error ? connectError.message : 'Erro interno',
      });
    } finally {
      onQrLoadingChange(false);
    }
  };

  const criarLinha = async () => {
    if (!novaLinha.instance.trim()) return;
    let created: { id: string; instance: string } | null = null;
    setBusy(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const response = await fetch('/api/department-connections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          departmentId,
          positionId: novaLinha.positionId || null,
          instance: novaLinha.instance,
          label: novaLinha.label,
          phone: novaLinha.phone,
          serverUrl: novaLinha.serverUrl,
          apiKey: novaLinha.apiKey,
        }),
      });
      const result = await response.json() as { success?: boolean; message?: string; id?: string };
      if (!response.ok || !result.success || !result.id) {
        throw new Error(result.message ?? 'Erro interno');
      }
      created = { id: result.id, instance: novaLinha.instance.trim() };
    } catch (createError) {
      toast.error('Falha ao adicionar número',
        {
          description: createError instanceof Error ? createError.message : 'Erro interno',
        });
      return;
    } finally {
      setBusy(false);
    }
    setNovaLinha({ label: '', instance: '', phone: '', positionId: '', serverUrl: '', apiKey: '' });
    toast.success('Linha salva. Gere o QR para conectar o telefone.');
    onLinhasCriada();
    if (created) void conectarLinha(created.id, created.instance);
  };

  const excluirLinha = async (linha: Linha) => {
    if (!window.confirm(`Remover a linha "${linha.label ?? linha.phone_number ?? linha.instance}"?`)) return;
    const supabase = getSupabase().schema('whatsapp_hub');
    const { count, error: countError } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', linha.id);
    if (countError) return toast.error('Falha ao verificar a linha', { description: countError.message });
    if ((count ?? 0) > 0) {
      return toast.error('Esta linha possui conversas e não pode ser removida.', {
        description: 'Mantenha a linha para que respostas e histórico continuem usando o número correto.',
      });
    }
    const { error } = await supabase
      .from('department_connections').delete().eq('id', linha.id);
    if (error) return toast.error('Falha ao remover número', { description: error.message });
    toast.success('Número removido.');
    onLinhasCriada();
  };

  const salvarCredencialLinha = async (
    linhaId: string,
    credential = credencialLinha,
  ) => {
    setBusy(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const response = await fetch('/api/department-connections', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ id: linhaId, ...credential }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? 'Erro interno');
      toast.success(credential.serverUrl.trim() ? 'Credencial própria salva.' : 'Linha usando a credencial global.');
      setLinhaCredencialAberta(null);
      setCredencialLinha({ serverUrl: '', apiKey: '' });
      onLinhasCriada();
    } catch (saveError) {
      toast.error('Falha ao salvar credencial',
        {
          description: saveError instanceof Error ? saveError.message : 'Erro interno',
        });
    } finally {
      setBusy(false);
    }
  };

  const destinoDisponivel = novaLinha.positionId
    ? cargosSemNumero.some((cargo) => cargo.id === novaLinha.positionId)
    : true;

  return (
    <section className="rounded-xl border border-[rgb(var(--accent-rgb)/0.12)] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-start gap-2">
        <Smartphone className="mt-0.5 h-4 w-4 text-[var(--accent-secondary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Números / linhas</h3>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Use o nome da instância Evolution. Sem cargo, a conversa entra na fila do setor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onCarregarStatus()}
          disabled={loadingStatus}
          className="ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[rgb(var(--accent-rgb)/0.2)] px-3 text-xs font-medium text-[var(--color-text-primary)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="space-y-2">
        {linhasDoSetor.map((linha) => {
          const cargo = doSetor.find((item) => item.id === linha.position_id);
          const status = statusLinhas[linha.id];
          return (
            <div key={linha.id} className="rounded-lg border border-[rgb(var(--accent-rgb)/0.1)] px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {linha.label ?? linha.phone_number ?? linha.instance}
                    </div>
                    {loadingStatus && !status ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--accent-secondary)]" />
                    ) : (
                      <span
                        title={status?.error}
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          status?.connected
                            ? 'bg-[rgba(16,185,129,0.14)] text-[var(--color-success)]'
                            : status
                              ? 'bg-[rgba(239,68,68,0.12)] text-[var(--color-error)]'
                              : 'bg-white/[0.06] text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {status?.connected
                          ? 'conectado'
                          : status?.configured
                            ? 'offline'
                            : status
                              ? 'não configurado'
                              : 'não verificado'}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-[var(--color-text-secondary)]">
                    {linha.phone_number ? `${linha.phone_number} · ` : ''}{linha.instance} · {cargo?.name ?? 'Fila do setor'} · {linha.server_url ? 'credencial própria' : 'credencial global'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void conectarLinha(linha.id, linha.instance)}
                  aria-label={`Gerar QR Code para ${linha.label ?? linha.instance}`}
                  title="Conectar telefone / gerar QR Code"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--accent-secondary)]"
                >
                  <QrCode className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const abrir = linhaCredencialAberta !== linha.id;
                    setLinhaCredencialAberta(abrir ? linha.id : null);
                    setCredencialLinha({ serverUrl: abrir ? (linha.server_url ?? '') : '', apiKey: '' });
                  }}
                  aria-label={`Configurar credencial da linha ${linha.label ?? linha.instance}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--accent-secondary)]"
                >
                  <KeyRound className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void excluirLinha(linha)}
                  aria-label={`Remover linha ${linha.label ?? linha.instance}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {linhaCredencialAberta === linha.id ? (
                <div className="mt-2 grid gap-2 border-t border-[rgb(var(--accent-rgb)/0.08)] pt-3 sm:grid-cols-2">
                  <input value={credencialLinha.serverUrl} onChange={(event) => setCredencialLinha((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="URL Evolution própria" className={inputCls} />
                  <input type="password" autoComplete="new-password" value={credencialLinha.apiKey} onChange={(event) => setCredencialLinha((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Digite a chave da linha" className={inputCls} />
                  <div className="flex gap-2 sm:col-span-2 sm:justify-end">
                    <button type="button" onClick={() => void salvarCredencialLinha(linha.id, { serverUrl: '', apiKey: '' })} disabled={busy} className="h-9 rounded-lg px-3 text-xs text-[var(--color-text-secondary)]">Usar global</button>
                    <button type="button" onClick={() => void salvarCredencialLinha(linha.id)} disabled={busy || !credencialLinha.serverUrl.trim() || !credencialLinha.apiKey.trim()} className="h-9 rounded-lg bg-[var(--accent-primary)] px-4 text-xs font-semibold text-white disabled:opacity-40">Salvar</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {linhasDoSetor.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] opacity-70">Nenhum número neste setor.</p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input value={novaLinha.label} onChange={(event) => setNovaLinha((c) => ({ ...c, label: event.target.value }))} placeholder="Nome visível (opcional)" className={inputCls} />
        <input value={novaLinha.phone} onChange={(event) => setNovaLinha((c) => ({ ...c, phone: event.target.value }))} placeholder="Telefone (opcional)" className={inputCls} />
        <input value={novaLinha.instance} onChange={(event) => setNovaLinha((c) => ({ ...c, instance: event.target.value }))} placeholder="Instância Evolution" className={inputCls} />
        <select value={novaLinha.positionId} onChange={(event) => setNovaLinha((c) => ({ ...c, positionId: event.target.value }))} className={inputCls}>
          <option value="">Fila do setor</option>
          {cargosSemNumero.map((cargo) => <option key={cargo.id} value={cargo.id}>{cargo.name}</option>)}
        </select>
        <input value={novaLinha.serverUrl} onChange={(event) => setNovaLinha((c) => ({ ...c, serverUrl: event.target.value }))} placeholder="URL Evolution própria (opcional)" className={inputCls} />
        <input type="password" autoComplete="new-password" value={novaLinha.apiKey} onChange={(event) => setNovaLinha((c) => ({ ...c, apiKey: event.target.value }))} placeholder="Chave da linha (opcional)" className={inputCls} />
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
        Deixe URL e chave vazias para usar a Evolution global. A chave própria é criptografada no servidor e nunca volta ao navegador.
      </p>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => void criarLinha()} disabled={busy || !novaLinha.instance.trim() || !destinoDisponivel} className="flex h-10 items-center gap-1.5 rounded-lg border border-[rgb(var(--accent-rgb)/0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40">
          <QrCode className="h-4 w-4" /> Criar e conectar número
        </button>
      </div>
    </section>
  );
}
