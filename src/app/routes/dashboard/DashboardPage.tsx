import { useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useOperators } from '@/hooks/useOperators';
import { useAttendanceMetrics } from '@/hooks/useAttendanceMetrics';
import { lineLabel, useDepartments } from '@/hooks/useDepartments';
import { AttendancePanel } from '@/components/dashboard/AttendancePanel';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

// O dashboard é uma central operacional de atendimento. Indicadores comerciais
// e financeiros pertencem ao módulo Vendas & Recompra, não a esta visão.
export default function DashboardPage() {
  const [departmentId, setDepartmentId] = useState('all');
  const [connectionId, setConnectionId] = useState('all');
  const { operators } = useOperators();
  const { departments, lines, loading: loadingDepartments } = useDepartments();
  const attendance = useAttendanceMetrics(
    departmentId === 'all' ? null : departmentId,
    connectionId === 'all' ? null : connectionId,
  );
  const visibleLines = departmentId === 'all'
    ? lines
    : lines.filter((line) => line.department_id === departmentId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="glass-card flex h-12 w-12 items-center justify-center rounded-xl">
            <LayoutDashboard className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Visão operacional</div>
            <h1 className="text-display text-2xl font-bold">Central de atendimento</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Filas, equipe e tempo de resposta em um só lugar
            </p>
          </div>
        </div>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
          <label className="w-full sm:w-56">
            <span className="mb-1.5 block text-label">Setor</span>
            <select
              value={departmentId}
              disabled={loadingDepartments}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setConnectionId('all');
              }}
              className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0F1223] px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--accent-primary)] disabled:opacity-50"
            >
              <option value="all">Todos os setores</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>
          <label className="w-full sm:w-56">
            <span className="mb-1.5 block text-label">Número / linha</span>
            <select
              value={connectionId}
              disabled={loadingDepartments || visibleLines.length === 0}
              onChange={(event) => setConnectionId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0F1223] px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--accent-primary)] disabled:opacity-50"
            >
              <option value="all">Todos os números</option>
              {visibleLines.map((line) => {
                const department = departments.find((item) => item.id === line.department_id);
                const label = departmentId === 'all' && department
                  ? `${department.name} — ${lineLabel(line)}`
                  : lineLabel(line);
                return <option key={line.id} value={line.id}>{label}</option>;
              })}
            </select>
          </label>
        </div>
      </div>

      {attendance.error ? (
        <LoadErrorBanner message={attendance.error} onRetry={() => void attendance.reload()} />
      ) : attendance.loading ? (
        <div className="glass-card p-10 text-center text-label opacity-60">
          Carregando atendimento...
        </div>
      ) : (
        <AttendancePanel metrics={attendance.metrics} operators={operators} />
      )}
    </div>
  );
}
