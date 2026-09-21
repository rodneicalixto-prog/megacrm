import { UserPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { Avatar } from '@/components/ui/Avatar';

interface Cargo {
  id: string;
  department_id: string;
  name: string;
  user_id: string | null;
}

interface Cobertura {
  id: string;
  position_id: string;
  covering_user_id: string;
  ends_at: string | null;
  reason: string | null;
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

interface DepartmentRolesProps {
  cargos: Cargo[];
  coberturas: Cobertura[];
  linhas: Linha[];
  departmentId: string;
  onCargoCriado: () => void;
}

const inputCls =
  'h-10 w-full rounded-lg border border-[rgb(var(--accent-rgb)/0.2)] bg-white/[0.03] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)] [&>option]:bg-[var(--color-bg-primary)] [&>option]:text-[var(--color-text-primary)]';

export function DepartmentRoles({ cargos, coberturas, linhas, departmentId, onCargoCriado }: DepartmentRolesProps) {
  const { operators } = useOperators();
  const doSetor = cargos.filter((c) => c.department_id === departmentId);
  const linhasDoSetor = linhas.filter((linha) => linha.department_id === departmentId);

  const [novoCargo, setNovoCargo] = useState('');
  const [busy, setBusy] = useState(false);
  const [coberturaAberta, setCoberturaAberta] = useState<string | null>(null);
  const [coberturaDraft, setCoberturaDraft] = useState<Record<string, {
    userId: string; endsAt: string; reason: string;
  }>>({});

  const criarCargo = async () => {
    const nome = novoCargo.trim();
    if (!nome) return;
    setBusy(true);
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions').insert({ department_id: departmentId, name: nome });
    setBusy(false);
    if (error) return toast.error('Falha ao criar cargo', { description: error.message });
    setNovoCargo('');
    toast.success('Cargo criado.');
    onCargoCriado();
  };

  const vincular = async (cargoId: string, userId: string | null) => {
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions').update({ user_id: userId }).eq('id', cargoId);
    if (error) return toast.error('Falha ao vincular', { description: error.message });
    toast.success(userId ? 'Pessoa vinculada ao cargo.' : 'Cargo liberado.');
    onCargoCriado();
  };

  const excluirCargo = async (id: string) => {
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('department_positions').delete().eq('id', id);
    if (error) return toast.error('Falha ao excluir', { description: error.message });
    onCargoCriado();
  };

  const alterarCoberturaDraft = (
    cargoId: string,
    field: 'userId' | 'endsAt' | 'reason',
    value: string,
  ) => {
    setCoberturaDraft((previous) => {
      const current = previous[cargoId] ?? { userId: '', endsAt: '', reason: '' };
      return { ...previous, [cargoId]: { ...current, [field]: value } };
    });
  };

  const iniciarCobertura = async (cargoId: string) => {
    const draft = coberturaDraft[cargoId];
    if (!draft?.userId) return toast.error('Selecione quem vai cobrir.');
    setBusy(true);
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('position_coverage')
      .insert({
        position_id: cargoId,
        covering_user_id: draft.userId,
        ends_at: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        reason: draft.reason.trim() || null,
      });
    setBusy(false);
    if (error) return toast.error('Falha ao iniciar cobertura', { description: error.message });
    toast.success('Cobertura iniciada — mensagens novas dessa linha vão para quem está cobrindo.');
    setCoberturaAberta(null);
    setCoberturaDraft((previous) => ({ ...previous, [cargoId]: { userId: '', endsAt: '', reason: '' } }));
    onCargoCriado();
  };

  const encerrarCobertura = async (coverageId: string) => {
    const { error } = await getSupabase().schema('whatsapp_hub')
      .from('position_coverage')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', coverageId);
    if (error) return toast.error('Falha ao encerrar cobertura', { description: error.message });
    toast.success('Cobertura encerrada. A linha volta a ser do titular.');
    onCargoCriado();
  };

  return (
    <div className="space-y-3">
      {doSetor.map((c) => {
        const pessoa = operators.find((o) => o.user_id === c.user_id);
        const temLinhaPessoal = linhasDoSetor.some((linha) => linha.position_id === c.id);
        const cobertura = coberturas.find((cov) => cov.position_id === c.id);
        const cobrindo = cobertura ? operators.find((o) => o.user_id === cobertura.covering_user_id) : null;
        const draft = coberturaDraft[c.id] ?? { userId: '', endsAt: '', reason: '' };
        return (
          <div key={c.id} className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                {c.user_id && temLinhaPessoal ? (
                  <button
                    type="button"
                    onClick={() => setCoberturaAberta(coberturaAberta === c.id ? null : c.id)}
                    className="h-9 shrink-0 rounded-lg border border-[rgb(var(--accent-rgb)/0.2)] px-3 text-xs font-medium text-[var(--color-text-primary)] whitespace-nowrap"
                  >
                    {cobertura ? 'Cobertura ativa' : 'Cobertura'}
                  </button>
                ) : null}
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

            {cobertura ? (
              <div className="ml-0 flex flex-wrap items-center gap-2 rounded-lg border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.06)] px-3 py-2 sm:ml-36">
                {cobrindo && <Avatar name={operatorLabel(cobrindo)} size="sm" />}
                <span className="text-xs text-[var(--color-text-primary)]">
                  {cobrindo ? operatorLabel(cobrindo) : 'Alguém'} está cobrindo esta linha
                  {cobertura.ends_at ? ` até ${new Date(cobertura.ends_at).toLocaleString('pt-BR')}` : ' — sem previsão de volta'}
                  {cobertura.reason ? ` · ${cobertura.reason}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void encerrarCobertura(cobertura.id)}
                  className="ml-auto h-7 shrink-0 rounded-lg border border-[rgba(239,68,68,0.3)] px-2.5 text-[11px] font-medium text-[var(--color-error)]"
                >
                  Encerrar cobertura
                </button>
              </div>
            ) : coberturaAberta === c.id ? (
              <div className="ml-0 grid gap-2 rounded-lg border border-[rgb(var(--accent-rgb)/0.15)] bg-white/[0.02] p-3 sm:ml-36 sm:grid-cols-3">
                <select
                  value={draft.userId}
                  onChange={(e) => alterarCoberturaDraft(c.id, 'userId', e.target.value)}
                  className={inputCls}
                >
                  <option value="">Quem vai cobrir…</option>
                  {operators.filter((o) => o.user_id !== c.user_id).map((o) => (
                    <option key={o.user_id} value={o.user_id}>{operatorLabel(o)}</option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(e) => alterarCoberturaDraft(c.id, 'endsAt', e.target.value)}
                  title="Previsão de volta (opcional — encerra sozinha nesse horário)"
                  className={inputCls}
                />
                <input
                  value={draft.reason}
                  onChange={(e) => alterarCoberturaDraft(c.id, 'reason', e.target.value)}
                  placeholder="Motivo (opcional)"
                  className={inputCls}
                />
                <div className="flex justify-end gap-2 sm:col-span-3">
                  <button
                    type="button"
                    onClick={() => setCoberturaAberta(null)}
                    className="h-9 rounded-lg px-3 text-xs text-[var(--color-text-secondary)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void iniciarCobertura(c.id)}
                    disabled={busy || !draft.userId}
                    className="h-9 rounded-lg bg-[var(--accent-primary)] px-4 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Iniciar cobertura
                  </button>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] sm:col-span-3">
                  Mensagens novas nessa linha vão para quem está cobrindo, sem tirar a linha própria dele. O titular não perde o cargo — a cobertura só decide o roteamento enquanto durar.
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
      {doSetor.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)] opacity-70">
          Nenhum cargo ainda.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={novoCargo}
          onChange={(e) => setNovoCargo(e.target.value)}
          placeholder="Novo cargo…"
          className={inputCls}
        />
        <button
          type="button"
          onClick={() => void criarCargo()}
          disabled={busy || !novoCargo.trim()}
          className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[rgb(var(--accent-rgb)/0.25)] px-4 text-sm font-medium text-[var(--color-text-primary)] disabled:opacity-40"
        >
          <UserPlus className="h-4 w-4" /> Cargo
        </button>
      </div>
    </div>
  );
}
