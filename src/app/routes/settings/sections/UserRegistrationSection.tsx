import { UserRoundPlus } from 'lucide-react';

export type RegistrationRole = 'operator' | 'supervisor' | 'admin';

interface DepartmentOption { id: string; name: string }
interface PositionOption { id: string; department_id: string; name: string; user_id: string | null }

interface Props {
  name: string;
  email: string;
  role: RegistrationRole;
  departmentId: string;
  positionId: string;
  departments: DepartmentOption[];
  positions: PositionOption[];
  busy: boolean;
  inputClass: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onRoleChange: (value: RegistrationRole) => void;
  onDepartmentChange: (value: string) => void;
  onPositionChange: (value: string) => void;
  onSubmit: () => void;
}

export function UserRegistrationSection({
  name, email, role, departmentId, positionId, departments, positions, busy,
  inputClass, onNameChange, onEmailChange, onRoleChange, onDepartmentChange,
  onPositionChange, onSubmit,
}: Props) {
  const availablePositions = positions.filter(
    (position) => position.department_id === departmentId && !position.user_id,
  );

  return (
    <div className="glass-card p-5">
      <header className="mb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <UserRoundPlus className="h-4 w-4 text-[var(--accent-primary)]" />
          Cadastrar usuário
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          A conta nasce sem senha — a pessoa define a dela em “Esqueci minha senha” na tela de login. Nenhuma senha compartilhada circula.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-label">Nome</span>
          <input value={name} onChange={(event) => onNameChange(event.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1.5">
          <span className="text-label">E-mail</span>
          <input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1.5">
          <span className="text-label">Função</span>
          <select value={role} onChange={(event) => onRoleChange(event.target.value as RegistrationRole)} className={inputClass}>
            <option value="operator">Atendente</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-label">Equipe / setor</span>
          <select value={departmentId} onChange={(event) => onDepartmentChange(event.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 sm:col-span-2">
          <span className="text-label">Cargo (opcional)</span>
          <select value={positionId} onChange={(event) => onPositionChange(event.target.value)} className={inputClass}>
            <option value="">Sem cargo — entra na fila do setor</option>
            {availablePositions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
          </select>
          <span className="block text-xs text-[var(--color-text-secondary)]">
            Com cargo, a conversa que chegar na linha desse cargo já nasce no nome dessa pessoa. Sem cargo, cai na fila do supervisor.
          </span>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onSubmit} disabled={busy || !name.trim() || !email.trim()} className="rounded-lg bg-[linear-gradient(135deg,#1E3A8A,var(--accent-primary))] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Cadastrando…' : 'Cadastrar'}
        </button>
      </div>
    </div>
  );
}
