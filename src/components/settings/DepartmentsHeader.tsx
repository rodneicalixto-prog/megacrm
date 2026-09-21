import { Building2, UserRoundPlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';

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

interface DepartmentsHeaderProps {
  departamentos: Departamento[];
  cargos: Cargo[];
  onDepartamentoCriado: () => void;
}

const inputCls =
  'h-10 w-full rounded-lg border border-[rgb(var(--accent-rgb)/0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[var(--color-bg-primary)] [&>option]:text-[var(--color-text-primary)]';

export function DepartmentsHeader({ departamentos, cargos, onDepartamentoCriado }: DepartmentsHeaderProps) {
  const [novoDepto, setNovoDepto] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState<'operator' | 'supervisor' | 'admin'>('operator');
  const [setorNovo, setSetorNovo] = useState('');
  const [cargoNovo, setCargoNovo] = useState('');
  const [busy, setBusy] = useState(false);
  const [criandoCargoUsuario, setCriandoCargoUsuario] = useState(false);
  const [nomeCargoUsuario, setNomeCargoUsuario] = useState('');

  const criarDepto = async () => {
    if (!novoDepto.trim()) return;
    setBusy(true);
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('departments').insert({ name: novoDepto.trim() });
    setBusy(false);
    if (error) return toast.error('Falha ao criar setor', { description: error.message });
    setNovoDepto('');
    toast.success('Setor criado.');
    onDepartamentoCriado();
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
    setCargoNovo((data as Cargo).id);
    setNomeCargoUsuario('');
    setCriandoCargoUsuario(false);
    toast.success('Cargo criado e selecionado.');
    onDepartamentoCriado();
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

    const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/invite`,
    });
    toast.success('Usuário cadastrado.', {
      description: resetError
        ? 'Cadastro feito, mas o e-mail de senha não foi enviado — peça pra pessoa usar "Esqueci minha senha" na tela de login.'
        : `Enviamos um e-mail para ${email.trim()} definir a senha.`,
    });
    setNome(''); setEmail(''); setCargoNovo('');
    onDepartamentoCriado();
  };

  return (
    <>
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
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[var(--accent-primary)] px-4 text-sm font-semibold text-white disabled:opacity-40"
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
            A conta nasce sem senha — a pessoa define a dela em "Esqueci minha senha"
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
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[rgb(var(--accent-rgb)/0.25)] px-3 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
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
    </>
  );
}
