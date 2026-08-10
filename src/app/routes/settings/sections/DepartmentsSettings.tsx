import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Trash2, UserPlus, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

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

const inputCls =
  'h-10 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[var(--color-bg-primary)] [&>option]:text-[var(--color-text-primary)]';

// Departamentos e cargos. Cargo é a peça que faltava ter tela: é ele que liga
// uma linha do WhatsApp a uma pessoa, e enquanto só existia no banco não havia
// como montar a estrutura da empresa sem SQL.
export function DepartmentsSettings() {
  const { operators } = useOperators();
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [novoDepto, setNovoDepto] = useState('');
  const [novoCargo, setNovoCargo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Cadastro de usuário: nome, e-mail, função e setor. Fica junto de setores e
  // cargos porque é a mesma decisão — criar alguém sem dizer onde ele atende
  // deixa a conta existindo e sem enxergar nada.
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState<'operator' | 'supervisor' | 'admin'>('operator');
  const [setorNovo, setSetorNovo] = useState('');
  const [cargoNovo, setCargoNovo] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase().schema('whatsapp_hub');
    const [d, c] = await Promise.all([
      supabase.from('departments').select('id, name, is_default').order('name'),
      supabase.from('department_positions').select('id, department_id, name, user_id').order('name'),
    ]);
    const loadError = d.error ?? c.error;
    if (loadError) {
      setError(loadError.message);
    } else {
      setDepartamentos((d.data ?? []) as Departamento[]);
      setCargos((c.data ?? []) as Cargo[]);
    }
    setLoading(false);
  }, []);

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
              onChange={(e) => { setSetorNovo(e.target.value); setCargoNovo(''); }}
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
        return (
          <div key={d.id} className="glass-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                {d.name}
                {d.is_default && (
                  <span className="rounded-full bg-[rgba(59,130,246,0.15)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-secondary)]">
                    padrão
                  </span>
                )}
              </h3>
              <button
                onClick={() => void excluirDepto(d)}
                aria-label={`Excluir ${d.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              {doSetor.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="min-w-[150px] text-sm text-[var(--color-text-primary)]">{c.name}</span>
                  <select
                    value={c.user_id ?? ''}
                    onChange={(e) => void vincular(c.id, e.target.value || null)}
                    className={`${inputCls} flex-1`}
                  >
                    <option value="">Sem pessoa (fila do supervisor)</option>
                    {operators.map((o) => (
                      <option key={o.user_id} value={o.user_id}>{operatorLabel(o)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => void excluirCargo(c.id)}
                    aria-label={`Excluir cargo ${c.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {doSetor.length === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)] opacity-70">
                  Nenhum cargo ainda.
                </p>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={novoCargo[d.id] ?? ''}
                onChange={(e) => setNovoCargo((p) => ({ ...p, [d.id]: e.target.value }))}
                placeholder="Novo cargo…"
                className={inputCls}
              />
              <button
                onClick={() => void criarCargo(d.id)}
                disabled={busy || !(novoCargo[d.id] ?? '').trim()}
                className="flex items-center gap-1.5 rounded-lg border border-[rgba(59,130,246,0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
              >
                <UserPlus className="h-4 w-4" /> Cargo
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
