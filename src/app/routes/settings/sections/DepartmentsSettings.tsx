import { useCallback, useEffect, useState } from 'react';
import { Building2, ChevronDown, KeyRound, Loader2, Plus, QrCode, RefreshCw, Smartphone, Trash2, UserPlus, UserRoundPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { Avatar } from '@/components/ui/Avatar';

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

interface QrDialogState {
  lineId: string;
  instance: string;
  image: string | null;
  pairingCode: string | null;
  warning: string | null;
  error: string | null;
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
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [statusLinhas, setStatusLinhas] = useState<Record<string, LinhaStatus>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [novoDepto, setNovoDepto] = useState('');
  const [novoCargo, setNovoCargo] = useState<Record<string, string>>({});
  const [criandoCargoUsuario, setCriandoCargoUsuario] = useState(false);
  const [nomeCargoUsuario, setNomeCargoUsuario] = useState('');
  const [novaLinha, setNovaLinha] = useState<Record<string, {
    label: string;
    instance: string;
    phone: string;
    positionId: string;
    serverUrl: string;
    apiKey: string;
  }>>({});
  const [busy, setBusy] = useState(false);
  const [linhaCredencialAberta, setLinhaCredencialAberta] = useState<string | null>(null);
  const [credencialLinha, setCredencialLinha] = useState({ serverUrl: '', apiKey: '' });
  const [setorAberto, setSetorAberto] = useState<string | null>(null);
  const [qrDialog, setQrDialog] = useState<QrDialogState | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // Cadastro de usuário: nome, e-mail, função e setor. Fica junto de setores e
  // cargos porque é a mesma decisão — criar alguém sem dizer onde ele atende
  // deixa a conta existindo e sem enxergar nada.
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState<'operator' | 'supervisor' | 'admin'>('operator');
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
      setLinhas((l.data ?? []) as Linha[]);
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

  const criarCargoUsuario = async () => {
    const cargoName = nomeCargoUsuario.trim();
    if (!setorNovo) return toast.error('Selecione primeiro a equipe / setor.');
    if (!cargoName) return;
    setBusy(true);
    const { data, error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions')
      .insert({ department_id: setorNovo, name: cargoName })
      .select('id, department_id, name, user_id')
      .single();
    setBusy(false);
    if (error || !data) {
      return toast.error('Falha ao criar cargo', { description: error?.message ?? 'Erro interno' });
    }
    const created = data as Cargo;
    setCargos((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    setCargoNovo(created.id);
    setNomeCargoUsuario('');
    setCriandoCargoUsuario(false);
    toast.success('Cargo criado e selecionado.');
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
    field: 'label' | 'instance' | 'phone' | 'positionId' | 'serverUrl' | 'apiKey',
    value: string,
  ) => {
    setNovaLinha((previous) => {
      const current = previous[departmentId] ?? {
        label: '', instance: '', phone: '', positionId: '', serverUrl: '', apiKey: '',
      };
      return { ...previous, [departmentId]: { ...current, [field]: value } };
    });
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

  const criarLinha = async (departmentId: string) => {
    const draft = novaLinha[departmentId];
    if (!draft?.instance.trim()) return;
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
          positionId: draft.positionId || null,
          instance: draft.instance,
          label: draft.label,
          phone: draft.phone,
          serverUrl: draft.serverUrl,
          apiKey: draft.apiKey,
        }),
      });
      const result = await response.json() as { success?: boolean; message?: string; id?: string };
      if (!response.ok || !result.success || !result.id) {
        throw new Error(result.message ?? 'Erro interno');
      }
      created = { id: result.id, instance: draft.instance.trim() };
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
    toast.success('Linha salva. Gere o QR para conectar o telefone.');
    void carregar();
    if (created) void conectarLinha(created.id, created.instance);
  };

  const excluirLinha = async (linha: Linha) => {
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
      void carregar();
    } catch (saveError) {
      toast.error('Falha ao salvar credencial', {
        description: saveError instanceof Error ? saveError.message : 'Erro interno',
      });
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

      <div className="glass-card p-5">
        <header className="mb-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <UserRoundPlus className="h-4 w-4 text-[var(--accent-primary)]" />
            Cadastrar usuário
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            A conta nasce sem senha — a pessoa define a dela em “Esqueci minha senha”
            na tela de login. Nenhuma senha compartilhada circula.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-label">Nome</div>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <div className="text-label">E-mail</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-label">Função</div>
            <select
              value={funcao}
              onChange={(e) => setFuncao(e.target.value as typeof funcao)}
              className={inputCls}
            >
              <option value="operator">Atendente</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <div className="text-label">Equipe / setor</div>
            <select
              value={setorNovo}
              onChange={(e) => { setSetorNovo(e.target.value); setCargoNovo(''); setCriandoCargoUsuario(false); setNomeCargoUsuario(''); }}
              className={inputCls}
            >
              <option value="">Selecione…</option>
              {departamentos.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <div className="text-label">Cargo (opcional)</div>
            <div className="flex gap-2">
              <select
                value={cargoNovo}
                onChange={(e) => setCargoNovo(e.target.value)}
                className={inputCls}
              >
                <option value="">Sem cargo — entra na fila do setor</option>
                {cargos
                  .filter((c) => c.department_id === setorNovo && !c.user_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => setCriandoCargoUsuario((current) => !current)}
                disabled={!setorNovo}
                title="Criar cargo neste setor"
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.25)] px-3 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Criar cargo
              </button>
            </div>
            {criandoCargoUsuario ? (
              <div className="flex gap-2">
                <input
                  value={nomeCargoUsuario}
                  onChange={(e) => setNomeCargoUsuario(e.target.value)}
                  placeholder="Nome do novo cargo"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => void criarCargoUsuario()}
                  disabled={busy || !nomeCargoUsuario.trim()}
                  className="h-10 shrink-0 rounded-lg bg-[var(--accent-primary)] px-4 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Salvar
                </button>
              </div>
            ) : null}
            <p className="text-xs text-[var(--color-text-secondary)]">
              Com cargo, a conversa que chegar na linha desse cargo já nasce no nome
              dessa pessoa. Sem cargo, cai na fila do supervisor.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={cadastrar}
            disabled={busy || !nome.trim() || !email.trim()}
            className="rounded-lg bg-[linear-gradient(135deg,#1E3A8A,var(--accent-primary))] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </div>
      </div>

      {departamentos.map((d) => {
        const doSetor = cargos.filter((c) => c.department_id === d.id);
        const linhasDoSetor = linhas.filter((linha) => linha.department_id === d.id);
        const cargosSemNumero = doSetor.filter(
          (cargo) => Boolean(cargo.user_id)
            && !linhasDoSetor.some((linha) => linha.position_id === cargo.id),
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
                <section className="mb-5 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-4">
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
                      onClick={() => void carregarStatus()}
                      disabled={loadingStatus}
                      className="ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.2)] px-3 text-xs font-medium text-[var(--color-text-primary)] disabled:opacity-50"
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
                        <div key={linha.id} className="rounded-lg border border-[rgba(59,130,246,0.1)] px-3 py-2">
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
                            <div className="mt-2 grid gap-2 border-t border-[rgba(59,130,246,0.08)] pt-3 sm:grid-cols-2">
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
                    <input value={draftLinha.label} onChange={(event) => alterarNovaLinha(d.id, 'label', event.target.value)} placeholder="Nome visível (opcional)" className={inputCls} />
                    <input value={draftLinha.phone} onChange={(event) => alterarNovaLinha(d.id, 'phone', event.target.value)} placeholder="Telefone (opcional)" className={inputCls} />
                    <input value={draftLinha.instance} onChange={(event) => alterarNovaLinha(d.id, 'instance', event.target.value)} placeholder="Instância Evolution" className={inputCls} />
                    <select value={draftLinha.positionId} onChange={(event) => alterarNovaLinha(d.id, 'positionId', event.target.value)} className={inputCls}>
                      <option value="">Fila do setor</option>
                      {cargosSemNumero.map((cargo) => <option key={cargo.id} value={cargo.id}>{cargo.name}</option>)}
                    </select>
                    <input value={draftLinha.serverUrl} onChange={(event) => alterarNovaLinha(d.id, 'serverUrl', event.target.value)} placeholder="URL Evolution própria (opcional)" className={inputCls} />
                    <input type="password" autoComplete="new-password" value={draftLinha.apiKey} onChange={(event) => alterarNovaLinha(d.id, 'apiKey', event.target.value)} placeholder="Chave da linha (opcional)" className={inputCls} />
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    Deixe URL e chave vazias para usar a Evolution global. A chave própria é criptografada no servidor e nunca volta ao navegador.
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => void criarLinha(d.id)} disabled={busy || !draftLinha.instance.trim() || !destinoDisponivel} className="flex h-10 items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40">
                      <QrCode className="h-4 w-4" /> Criar e conectar número
                    </button>
                  </div>
                </section>

                <div className="space-y-3">
                  {doSetor.map((c) => {
                    const pessoa = operators.find((o) => o.user_id === c.user_id);
                    return (
                    <div key={c.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)] sm:w-36 sm:shrink-0">
                        {pessoa && <Avatar name={operatorLabel(pessoa)} size="sm" />}
                        <span className="truncate">{c.name}</span>
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
                    );
                  })}
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
      {qrDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evolution-qr-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setQrDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[rgba(59,130,246,0.25)] bg-[var(--color-bg-primary)] p-5 shadow-2xl"
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
                className="h-10 rounded-lg border border-[rgba(59,130,246,0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
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
