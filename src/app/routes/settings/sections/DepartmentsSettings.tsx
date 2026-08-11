import { useCallback, useEffect, useState } from 'react';
import { Building2, ChevronDown, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import {
  DepartmentLinesSection,
  type DepartmentLine,
  type DepartmentLineDraft,
  type DepartmentLineStatus,
} from './DepartmentLinesSection';
import { UserRegistrationSection, type RegistrationRole } from './UserRegistrationSection';

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

interface LinhaStatus {
  configured: boolean;
  connected: boolean;
  state: string | null;
  error?: string;
}

const inputCls =
  'h-10 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[var(--color-bg-primary)] [&>option]:text-[var(--color-text-primary)]';

// Departamentos e cargos. Cargo é a peça que faltava ter tela: é ele que liga
// uma linha do WhatsApp a uma pessoa, e enquanto só existia no banco não havia
// como montar a estrutura da empresa sem SQL.
export function DepartmentsSettings() {
  const { operators } = useOperators();
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [linhas, setLinhas] = useState<DepartmentLine[]>([]);
  const [statusLinhas, setStatusLinhas] = useState<Record<string, DepartmentLineStatus>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [novoDepto, setNovoDepto] = useState('');
  const [novoCargo, setNovoCargo] = useState<Record<string, string>>({});
  const [novaLinha, setNovaLinha] = useState<Record<string, DepartmentLineDraft>>({});
  const [busy, setBusy] = useState(false);
  const [setorAberto, setSetorAberto] = useState<string | null>(null);

  // Cadastro de usuário: nome, e-mail, função e setor. Fica junto de setores e
  // cargos porque é a mesma decisão — criar alguém sem dizer onde ele atende
  // deixa a conta existindo e sem enxergar nada.
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState<RegistrationRole>('operator');
  const [setorNovo, setSetorNovo] = useState('');
  const [cargoNovo, setCargoNovo] = useState('');

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
        statuses?: Array<DepartmentLineStatus & { id: string }>;
      };
      if (!response.ok || !body.success) throw new Error(body.message ?? 'Falha ao consultar linhas.');
      setStatusLinhas(Object.fromEntries((body.statuses ?? []).map(({ id, ...status }) => [id, status])));
    } catch (statusError) {
      toast.error('Não foi possível atualizar as conexões', {
        description: statusError instanceof Error ? statusError.message : 'Erro interno',
      });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase().schema('whatsapp_hub');
    const [d, c, l] = await Promise.all([
      supabase.from('departments').select('id, name, is_default').order('name'),
      supabase.from('department_positions').select('id, department_id, name, user_id').order('name'),
      supabase.from('department_connections')
        .select('id, department_id, position_id, instance, phone_number, label, server_url')
        .order('created_at'),
    ]);
    const loadError = d.error ?? c.error ?? l.error;
    if (loadError) {
      setError(loadError.message);
    } else {
      setDepartamentos((d.data ?? []) as Departamento[]);
      setCargos((c.data ?? []) as Cargo[]);
      setLinhas((l.data ?? []) as DepartmentLine[]);
      void carregarStatus();
    }
    setLoading(false);
  }, [carregarStatus]);

  useEffect(() => { void carregar(); }, [carregar]);

  const criarDepto = async () => {
    if (!novoDepto.trim()) return;
    setBusy(true);
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('departments').insert({ name: novoDepto.trim() });
    setBusy(false);
    if (error) return toast.error('Falha ao criar setor', { description: error.message });
    setNovoDepto('');
    toast.success('Setor criado.');
    void carregar();
  };

  const excluirDepto = async (d: Departamento) => {
    if (d.is_default) {
      // O padrão é para onde caem mensagens de linha desconhecida. Sem ele,
      // essas mensagens são recusadas em vez de aterrissarem em algum lugar.
      return toast.error('O setor padrão não pode ser excluído.');
    }
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('departments').delete().eq('id', d.id);
    if (error) return toast.error('Falha ao excluir', { description: error.message });
    toast.success('Setor excluído.');
    void carregar();
  };

  const criarCargo = async (deptoId: string) => {
    const nome = (novoCargo[deptoId] ?? '').trim();
    if (!nome) return;
    setBusy(true);
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions').insert({ department_id: deptoId, name: nome });
    setBusy(false);
    if (error) return toast.error('Falha ao criar cargo', { description: error.message });
    setNovoCargo((p) => ({ ...p, [deptoId]: '' }));
    toast.success('Cargo criado.');
    void carregar();
  };

  const vincular = async (cargoId: string, userId: string | null) => {
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions').update({ user_id: userId }).eq('id', cargoId);
    if (error) return toast.error('Falha ao vincular', { description: error.message });
    toast.success(userId ? 'Pessoa vinculada ao cargo.' : 'Cargo liberado.');
    void carregar();
  };

  const excluirCargo = async (id: string) => {
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions').delete().eq('id', id);
    if (error) return toast.error('Falha ao excluir', { description: error.message });
    void carregar();
  };

  const alterarNovaLinha = (
    departmentId: string,
    field: keyof DepartmentLineDraft,
    value: string,
  ) => {
    setNovaLinha((previous) => {
      const current = previous[departmentId] ?? {
        label: '', instance: '', phone: '', positionId: '', serverUrl: '', apiKey: '',
      };
      return { ...previous, [departmentId]: { ...current, [field]: value } };
    });
  };

  const criarLinha = async (departmentId: string) => {
    const draft = novaLinha[departmentId];
    if (!draft?.instance.trim()) return;
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
          positionId: draft.positionId || null,
          instance: draft.instance,
          label: draft.label,
          phone: draft.phone,
          serverUrl: draft.serverUrl,
          apiKey: draft.apiKey,
        }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? 'Erro interno');
    } catch (createError) {
      toast.error('Falha ao adicionar número', {
        description: createError instanceof Error ? createError.message : 'Erro interno',
      });
      return;
    } finally {
      setBusy(false);
    }
    setNovaLinha((previous) => ({
      ...previous,
      [departmentId]: { label: '', instance: '', phone: '', positionId: '', serverUrl: '', apiKey: '' },
    }));
    toast.success('Número adicionado ao setor.');
    void carregar();
  };

  const excluirLinha = async (linha: DepartmentLine) => {
    if (!window.confirm(`Remover a linha “${linha.label ?? linha.phone_number ?? linha.instance}”?`)) return;
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
    void carregar();
  };

  const salvarCredencialLinha = async (
    linhaId: string,
    credential: { serverUrl: string; apiKey: string },
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
      void carregar();
      return true;
    } catch (saveError) {
      toast.error('Falha ao salvar credencial', {
        description: saveError instanceof Error ? saveError.message : 'Erro interno',
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cadastrar = async () => {
    if (!nome.trim() || !email.trim()) return;
    setBusy(true);
    const { error } = await getSupabase().schema('whatsapp_hub').rpc('create_user', {
      p_nome: nome.trim(),
      p_email: email.trim(),
      p_funcao: funcao,
      p_department_id: setorNovo || null,
      p_position_id: cargoNovo || null,
    });
    setBusy(false);
    if (error) return toast.error('Falha ao cadastrar', { description: error.message });
    toast.success('Usuário cadastrado.', {
      description: 'A senha é definida pela própria pessoa em "Esqueci minha senha".',
    });
    setNome(''); setEmail(''); setCargoNovo('');
    void carregar();
  };

  if (loading) return <div className="text-label opacity-60">Carregando…</div>;

  return (
    <div className="space-y-5">
      {error && <LoadErrorBanner message={error} onRetry={() => void carregar()} />}
      <div className="glass-card p-5">
        <header className="mb-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Building2 className="h-4 w-4 text-[var(--accent-primary)]" />
            Setores
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Cada setor tem seus cargos. É o cargo que recebe a linha de WhatsApp e a
            pessoa — uma conversa que chega numa linha de cargo já nasce atribuída.
          </p>
        </header>
        <div className="flex gap-2">
          <input
            value={novoDepto}
            onChange={(e) => setNovoDepto(e.target.value)}
            placeholder="Novo setor…"
            className={inputCls}
          />
          <button
            onClick={criarDepto}
            disabled={busy || !novoDepto.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Criar
          </button>
        </div>
      </div>

      <UserRegistrationSection
        name={nome}
        email={email}
        role={funcao}
        departmentId={setorNovo}
        positionId={cargoNovo}
        departments={departamentos}
        positions={cargos}
        busy={busy}
        inputClass={inputCls}
        onNameChange={setNome}
        onEmailChange={setEmail}
        onRoleChange={setFuncao}
        onDepartmentChange={(value) => { setSetorNovo(value); setCargoNovo(''); }}
        onPositionChange={setCargoNovo}
        onSubmit={() => void cadastrar()}
      />

      {departamentos.map((d) => {
        const doSetor = cargos.filter((c) => c.department_id === d.id);
        const linhasDoSetor = linhas.filter((linha) => linha.department_id === d.id);
        const cargosSemNumero = doSetor.filter(
          (cargo) => !linhasDoSetor.some((linha) => linha.position_id === cargo.id),
        );
        const draftLinha = novaLinha[d.id] ?? {
          label: '', instance: '', phone: '', positionId: '', serverUrl: '', apiKey: '',
        };
        const destinoDisponivel = draftLinha.positionId
          ? cargosSemNumero.some((cargo) => cargo.id === draftLinha.positionId)
          : true;
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
                      <span className="shrink-0 rounded-full bg-[rgba(59,130,246,0.15)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-secondary)]">
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
                className="border-t border-[rgba(59,130,246,0.08)] px-5 pb-5 pt-4"
              >
                <DepartmentLinesSection
                  departmentId={d.id}
                  lines={linhasDoSetor}
                  positions={doSetor}
                  availablePositions={cargosSemNumero}
                  statuses={statusLinhas}
                  loadingStatus={loadingStatus}
                  busy={busy}
                  draft={draftLinha}
                  destinationAvailable={destinoDisponivel}
                  inputClass={inputCls}
                  onRefresh={() => void carregarStatus()}
                  onDraftChange={(field, value) => alterarNovaLinha(d.id, field, value)}
                  onCreate={() => void criarLinha(d.id)}
                  onDelete={(line) => void excluirLinha(line)}
                  onSaveCredentials={salvarCredencialLinha}
                />

                <div className="space-y-3">
                  {doSetor.map((c) => (
                    <div key={c.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="text-sm font-medium text-[var(--color-text-primary)] sm:w-36 sm:shrink-0">
                        {c.name}
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <select
                          value={c.user_id ?? ''}
                          onChange={(e) => void vincular(c.id, e.target.value || null)}
                          className={`${inputCls} min-w-0 flex-1`}
                        >
                          <option value="">Sem pessoa (fila do supervisor)</option>
                          {operators.map((o) => (
                            <option key={o.user_id} value={o.user_id}>{operatorLabel(o)}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void excluirCargo(c.id)}
                          aria-label={`Excluir cargo ${c.name}`}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {doSetor.length === 0 && (
                    <p className="text-sm text-[var(--color-text-secondary)] opacity-70">
                      Nenhum cargo ainda.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={novoCargo[d.id] ?? ''}
                    onChange={(e) => setNovoCargo((p) => ({ ...p, [d.id]: e.target.value }))}
                    placeholder="Novo cargo…"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => void criarCargo(d.id)}
                    disabled={busy || !(novoCargo[d.id] ?? '').trim()}
                    className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
                  >
                    <UserPlus className="h-4 w-4" /> Cargo
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
