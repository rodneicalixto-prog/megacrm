import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Clock, Loader2, Trash2, X, QrCode, Search } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { BusinessHoursEditor, type BusinessHours } from '@/components/settings/BusinessHoursEditor';
import { DepartmentsHeader } from '@/components/settings/DepartmentsHeader';
import { DepartmentLines } from '@/components/settings/DepartmentLines';
import { DepartmentRoles } from '@/components/settings/DepartmentRoles';

interface Departamento {
  id: string;
  name: string;
  is_default: boolean;
}

interface Cargo {
  id: string;
  department_id: string;
  name: string;
  user_id: string | null;
}

interface Linha {
  id: string;
  department_id: string;
  position_id: string | null;
  instance: string;
  phone_number: string | null;
  label: string | null;
  server_url: string | null;
}

interface Cobertura {
  id: string;
  position_id: string;
  covering_user_id: string;
  ends_at: string | null;
  reason: string | null;
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

// Departamentos e cargos. Cargo é a peça que faltava ter tela: é ele que liga
// uma linha do WhatsApp a uma pessoa, e enquanto só existia no banco não havia
// como montar a estrutura da empresa sem SQL.
export function DepartmentsSettings() {
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [coberturas, setCoberturas] = useState<Cobertura[]>([]);
  const [statusLinhas, setStatusLinhas] = useState<Record<string, LinhaStatus>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setorAberto, setSetorAberto] = useState<string | null>(null);
  const [qrDialog, setQrDialog] = useState<QrDialogState | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const carregarStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/department-connection-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as {
        success?: boolean;
        message?: string;
        statuses?: Array<LinhaStatus & { id: string }>;
      };
      if (!response.ok || !body.success) throw new Error(body.message ?? 'Falha ao consultar linhas.');
      const statuses = body.statuses ?? [];
      setStatusLinhas(Object.fromEntries(statuses.map(({ id, ...status }) => [id, status])));
      return statuses;
    } catch (statusError) {
      toast.error('Não foi possível atualizar as conexões', {
        description: statusError instanceof Error ? statusError.message : 'Erro interno',
      });
      return [];
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase().schema('whatsapp_hub');
    const [d, c, l, cob] = await Promise.all([
      supabase.from('departments').select('id, name, is_default').order('name'),
      supabase.from('department_positions').select('id, department_id, name, user_id').order('name'),
      supabase.from('department_connections')
        .select('id, department_id, position_id, instance, phone_number, label, server_url')
        .order('created_at'),
      supabase.from('position_coverage')
        .select('id, position_id, covering_user_id, ends_at, reason')
        .is('ended_at', null),
    ]);
    const loadError = d.error ?? c.error ?? l.error ?? cob.error;
    if (loadError) {
      setError(loadError.message);
    } else {
      setDepartamentos((d.data ?? []) as Departamento[]);
      setCargos((c.data ?? []) as Cargo[]);
      setLinhas((l.data ?? []) as Linha[]);
      setCoberturas((cob.data ?? []) as Cobertura[]);
      void carregarStatus();
    }
    setLoading(false);
  }, [carregarStatus]);

  useEffect(() => { void carregar(); }, [carregar]);

  const excluirDepto = async (d: Departamento) => {
    if (d.is_default) {
      return toast.error('O setor padrão não pode ser excluído.');
    }
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('departments').delete().eq('id', d.id);
    if (error) return toast.error('Falha ao excluir', { description: error.message });
    toast.success('Setor excluído.');
    void carregar();
  };

  const conectarLinha = async (lineId: string, instance: string) => {
    setQrDialog({ lineId, instance, image: null, pairingCode: null, warning: null, error: null });
    setQrLoading(true);
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
      setQrDialog({
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
      setQrDialog({
        lineId,
        instance,
        image: null,
        pairingCode: null,
        warning: null,
        error: connectError instanceof Error ? connectError.message : 'Erro interno',
      });
    } finally {
      setQrLoading(false);
    }
  };

  const verificarConexaoQr = async () => {
    if (!qrDialog) return;
    const statuses = await carregarStatus();
    const status = statuses.find((item) => item.id === qrDialog.lineId);
    if (status?.connected) {
      setQrDialog(null);
      toast.success('WhatsApp conectado à linha.');
      void carregar();
      return;
    }
    toast.info('O telefone ainda não está conectado.', {
      description: status?.error ?? 'Escaneie o QR pelo WhatsApp e tente novamente.',
    });
  };

  if (loading) return <div className="text-label opacity-60">Carregando…</div>;

  const filtered = departamentos.filter((d) =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {error && <LoadErrorBanner message={error} onRetry={() => void carregar()} />}

      <DepartmentsHeader
        departamentos={departamentos}
        cargos={cargos}
        onDepartamentoCriado={() => void carregar()}
      />

      <div className="flex items-center gap-2 rounded-xl border border-[rgb(var(--accent-rgb)/0.12)] bg-white/[0.02] px-3 py-2.5">
        <Search className="h-4 w-4 text-[var(--color-text-secondary)]" />
        <input
          type="text"
          placeholder="Buscar setores…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] outline-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((d) => {
        const doSetor = cargos.filter((c) => c.department_id === d.id);
        const linhasDoSetor = linhas.filter((linha) => linha.department_id === d.id);
        const vinculados = doSetor.filter((c) => c.user_id).length;
        const aberto = setorAberto === d.id;
        return (
          <div key={d.id} className="group overflow-hidden rounded-xl border border-[rgb(var(--accent-rgb)/0.12)] bg-white/[0.02] transition-all duration-200 hover:border-[rgb(var(--accent-rgb)/0.25)] hover:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => setSetorAberto(aberto ? null : d.id)}
              aria-expanded={aberto}
              aria-controls={`setor-${d.id}`}
              className="w-full text-left transition-colors"
            >
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{d.name}</h3>
                      {d.is_default && (
                        <span className="shrink-0 rounded-full bg-[rgb(var(--accent-rgb)/0.15)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--accent-secondary)]">
                          padrão
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                      <span className="font-medium text-[var(--color-text-primary)]">{doSetor.length}</span> {doSetor.length === 1 ? 'cargo' : 'cargos'} · <span className="font-medium text-[var(--color-text-primary)]">{vinculados}</span> {vinculados === 1 ? 'pessoa' : 'pessoas'} · <span className="font-medium text-[var(--color-text-primary)]">{linhasDoSetor.length}</span> {linhasDoSetor.length === 1 ? 'número' : 'números'}
                    </p>
                  </div>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-200 ${aberto ? 'rotate-180' : ''}`}
                  />
                </div>

                {!aberto && (
                  <div className="flex flex-wrap gap-1">
                    {linhasDoSetor.slice(0, 2).map((linha) => (
                      <span key={linha.id} className="rounded-md bg-[rgb(var(--accent-rgb)/0.1)] px-2 py-1 text-[10px] font-medium text-[var(--accent-secondary)]">
                        {linha.label || `${linha.phone_number?.slice(-4) || 'sem número'}`}
                      </span>
                    ))}
                    {linhasDoSetor.length > 2 && (
                      <span className="rounded-md bg-[rgb(var(--accent-rgb)/0.1)] px-2 py-1 text-[10px] font-medium text-[var(--accent-secondary)]">
                        +{linhasDoSetor.length - 2}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>

            {aberto && (
              <div
                id={`setor-${d.id}`}
                className="border-t border-[rgb(var(--accent-rgb)/0.08)] px-4 pb-4 pt-3"
              >
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void excluirDepto(d)}
                    aria-label={`Excluir ${d.name}`}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[rgb(var(--accent-rgb)/0.25)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.02] hover:text-[var(--color-error)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Excluir
                  </button>
                </div>
                <DepartmentLines
                  cargos={cargos}
                  linhas={linhas}
                  statusLinhas={statusLinhas}
                  loadingStatus={loadingStatus}
                  departmentId={d.id}
                  qrDialog={qrDialog}
                  qrLoading={qrLoading}
                  onLinhasCriada={() => void carregar()}
                  onCarregarStatus={carregarStatus}
                  onQrDialogChange={setQrDialog}
                  onQrLoadingChange={setQrLoading}
                />

                <section className="mb-5 rounded-xl border border-[rgb(var(--accent-rgb)/0.12)] bg-white/[0.02] p-4">
                  <div className="mb-3 flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 text-[var(--accent-secondary)]" />
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Horário de atendimento do setor</h3>
                    </div>
                  </div>
                  <BusinessHoursEditor
                    title=""
                    description=""
                    nullable
                    inheritLabel="Usar o horário padrão da instância"
                    load={async () => {
                      const { data } = await getSupabase()
                        .schema('whatsapp_hub')
                        .from('departments')
                        .select('business_hours, out_of_hours_message')
                        .eq('id', d.id)
                        .maybeSingle();
                      return data ?? null;
                    }}
                    save={async (patch: { business_hours: BusinessHours | null; out_of_hours_message: string | null }) => {
                      const { error } = await getSupabase()
                        .schema('whatsapp_hub')
                        .from('departments')
                        .update({ business_hours: patch.business_hours, out_of_hours_message: patch.out_of_hours_message })
                        .eq('id', d.id);
                      return { error: error?.message };
                    }}
                  />
                </section>

                <DepartmentRoles
                  cargos={cargos}
                  coberturas={coberturas}
                  linhas={linhas}
                  departmentId={d.id}
                  onCargoCriado={() => void carregar()}
                />
              </div>
            )}
          </div>
        );
      })}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-[rgb(var(--accent-rgb)/0.12)] bg-white/[0.02] py-8 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {searchTerm ? 'Nenhum setor encontrado.' : 'Nenhum setor criado ainda.'}
          </p>
        </div>
      )}

      {qrDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evolution-qr-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setQrDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[rgb(var(--accent-rgb)/0.25)] bg-[var(--color-bg-primary)] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <QrCode className="mt-0.5 h-5 w-5 text-[var(--accent-secondary)]" />
              <div className="min-w-0 flex-1">
                <h3 id="evolution-qr-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Conectar {qrDialog.instance}
                </h3>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  No WhatsApp do telefone, abra Aparelhos conectados, escolha Conectar aparelho e leia o QR Code.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrDialog(null)}
                aria-label="Fechar QR Code"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex min-h-64 items-center justify-center">
              {qrLoading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Loader2 className="h-5 w-5 animate-spin" /> Gerando QR Code…
                </div>
              ) : qrDialog.image ? (
                <img
                  src={qrDialog.image}
                  alt={`QR Code da instância ${qrDialog.instance}`}
                  className="h-64 w-64 bg-white p-2"
                />
              ) : qrDialog.pairingCode ? (
                <div className="text-center">
                  <div className="text-xs uppercase text-[var(--color-text-secondary)]">Código de pareamento</div>
                  <code className="mt-2 block text-2xl font-semibold tracking-[0.12em] text-[var(--color-text-primary)]">
                    {qrDialog.pairingCode}
                  </code>
                </div>
              ) : (
                <p className="max-w-sm text-center text-sm text-[var(--color-error)]">
                  {qrDialog.error ?? 'QR Code indisponível.'}
                </p>
              )}
            </div>

            {qrDialog.warning ? (
              <p className="mt-3 text-xs text-[var(--color-warning)]">{qrDialog.warning}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void conectarLinha(qrDialog.lineId, qrDialog.instance)}
                disabled={qrLoading}
                className="h-10 rounded-lg border border-[rgb(var(--accent-rgb)/0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
              >
                Gerar novo QR
              </button>
              <button
                type="button"
                onClick={() => void verificarConexaoQr()}
                disabled={loadingStatus}
                className="flex h-10 items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {loadingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Já escaneei, verificar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
