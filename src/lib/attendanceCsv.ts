import type { AttendanceMetrics } from '@/hooks/useAttendanceMetrics';

interface OperatorIdentity {
  user_id: string;
  email: string | null;
}

function safeCell(value: string | number | boolean | null | undefined): string {
  let text = value == null ? '' : String(value);
  // Evita que Excel/LibreOffice interpretem conteúdo vindo de contato como fórmula.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildAttendanceCsv(
  metrics: AttendanceMetrics,
  operators: OperatorIdentity[],
  generatedAt = new Date(),
): string {
  const rows: Array<Array<string | number | boolean | null | undefined>> = [
    ['Relatório operacional de atendimento'],
    ['Gerado em', generatedAt.toLocaleString('pt-BR')],
    [],
    ['Indicador', 'Valor'],
    ['Aguardando', metrics.aguardando],
    ['Em andamento', metrics.em_andamento],
    ['Sem resposta', metrics.sem_resposta],
    ['Finalizados hoje', metrics.finalizados_hoje],
    ['Tempo médio da primeira resposta (segundos)', metrics.tempo_medio_primeira_resposta],
    ['Tempo médio do atendimento (segundos)', metrics.tempo_medio_atendimento],
    ['Atendentes online', metrics.agentes_online],
    ['Total de atendentes', metrics.agentes_total],
    [],
    ['Conversas por atendente'],
    ['Atendente', 'Online', 'Abertas', 'Fechadas hoje'],
    ...metrics.por_agente.map((agent) => [
      operators.find((operator) => operator.user_id === agent.user_id)?.email ?? 'Sem responsável',
      agent.is_online ? 'Sim' : 'Não',
      agent.abertas,
      agent.fechadas_hoje,
    ]),
    [],
    ['Volume dos últimos 7 dias'],
    ['Data', 'Novas conversas'],
    ...metrics.serie_7_dias.map((day) => [day.dia, day.novas]),
    [],
    ['Conversas paradas'],
    ['Contato', 'Telefone', 'Responsável', 'Horas sem resposta', 'ID da conversa'],
    ...metrics.paradas.map((conversation) => [
      conversation.contact_name ?? '',
      conversation.contact_phone ?? '',
      conversation.assigned_to
        ? operators.find((operator) => operator.user_id === conversation.assigned_to)?.email ?? 'Responsável não encontrado'
        : 'Sem responsável',
      conversation.horas_parada,
      conversation.conversation_id,
    ]),
  ];

  return `\uFEFF${rows.map((row) => row.map(safeCell).join(';')).join('\r\n')}`;
}

export function downloadAttendanceCsv(metrics: AttendanceMetrics, operators: OperatorIdentity[]): void {
  const csv = buildAttendanceCsv(metrics, operators);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `atendimento-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
