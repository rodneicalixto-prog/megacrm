import { describe, expect, it } from 'vitest';
import { buildAttendanceCsv } from '../../src/lib/attendanceCsv';
import type { AttendanceMetrics } from '../../src/hooks/useAttendanceMetrics';

const metrics: AttendanceMetrics = {
  aguardando: 2,
  em_andamento: 3,
  sem_resposta: 1,
  finalizados_hoje: 4,
  tempo_medio_primeira_resposta: 90,
  tempo_medio_atendimento: 600,
  agentes_online: 1,
  agentes_total: 2,
  por_agente: [{ user_id: 'user-1', is_online: true, abertas: 3, fechadas_hoje: 4 }],
  serie_7_dias: [{ dia: '2026-08-11', novas: 5 }],
  paradas: [{
    conversation_id: 'conversation-1',
    contact_name: '=SOMA(1;1)',
    contact_phone: '5511999999999',
    assigned_to: 'user-1',
    horas_parada: 25,
  }],
};

describe('buildAttendanceCsv', () => {
  it('exporta indicadores, carga, série e conversas paradas', () => {
    const csv = buildAttendanceCsv(
      metrics,
      [{ user_id: 'user-1', email: 'atendente@example.com' }],
      new Date('2026-08-11T12:00:00Z'),
    );

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Aguardando";"2"');
    expect(csv).toContain('"atendente@example.com";"Sim";"3";"4"');
    expect(csv).toContain('"2026-08-11";"5"');
    expect(csv).toContain('"conversation-1"');
  });

  it('neutraliza fórmulas vindas de dados de contatos', () => {
    const csv = buildAttendanceCsv(metrics, [], new Date('2026-08-11T12:00:00Z'));
    expect(csv).toContain('"\'=SOMA(1;1)"');
    expect(csv).not.toContain('\r\n"=SOMA(1;1)"');
  });
});
