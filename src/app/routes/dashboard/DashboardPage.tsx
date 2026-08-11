import { LayoutDashboard } from 'lucide-react';
import { useOperators } from '@/hooks/useOperators';
import { useAttendanceMetrics } from '@/hooks/useAttendanceMetrics';
import { AttendancePanel } from '@/components/dashboard/AttendancePanel';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';

// O dashboard é uma central operacional de atendimento. Indicadores comerciais
// e financeiros pertencem ao módulo Vendas & Recompra, não a esta visão.
export default function DashboardPage() {
  const { operators } = useOperators();
  const attendance = useAttendanceMetrics();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
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
