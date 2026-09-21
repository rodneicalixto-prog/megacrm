import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Clock, Loader2, Trash2, X, QrCode } from 'lucide-react';
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

  return (
    <div className="space-y-5">
      {error && <LoadErrorBanner message={error} onRetry={() => void carregar()} />}

      <DepartmentsHeader
        departamentos={departamentos}
        cargos={cargos}
        onDepartamentoCriado={() => void carregar()}
      />

      {departamentos.map((d) => {
        const doSetor = cargos.filter((c) => c.department_id === d.id);
        const linhasDoSetor = linhas.filter((linha) => linha.department_id === d.id);
        const vinculados = doSetor.filter((c) => c.user_id).length;
        const aberto = setorAberto === d.id;
        return (
          <div key={d.id} className="glass-card overflow-hidden">
            <div className="flex items-center gap-2 p-2">
              <button
                type="button"
                onClick={() => setSetorAberto(aberto ? null : d.id)}
                aria-expanded={aberto}
                aria-controls={`setor-${d.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                    <span className="truncate">{d.name}</span>
                    {d.is_default && (
                      <span className="shrink-0 rounded-full bg-[rgb(var(--accent-rgb)/0.15)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-secondary)]">
                        padrão
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
                    {doSetor.length === 0
                      ? 'Nenhum cargo'
                      : `${doSetor.length} ${doSetor.length === 1 ? 'cargo' : 'cargos'} · ${vinculados} ${vinculados === 1 ? 'pessoa vinculada' : 'pessoas vinculadas'}`}
                    {` · ${linhasDoSetor.length} ${linhasDoSetor.length === 1 ? 'número' : 'números'}`}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-200 ${aberto ? 'rotate-180' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={() => void excluirDepto(d)}
                aria-label={`Excluir ${d.name}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.03] hover:text-[var(--color-error)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {aberto && (
              <div
                id={`setor-${d.id}`}
                className="border-t border-[rgb(var(--accent-rgb)/0.08)] px-5 pb-5 pt-4"
              >
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
