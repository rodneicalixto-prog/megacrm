import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

// Painel de ATENDIMENTO: fila, tempos e carga por atendente. Esta consulta é
// exclusiva da central operacional.
//
// Uma RPC única: os tempos médios exigem correlacionar mensagens por conversa, e
// fazer isso no cliente significaria baixar a tabela de mensagens inteira.

export interface AgentLoad {
  user_id: string;
  is_online: boolean;
  abertas: number;
  fechadas_hoje: number;
}

export interface StalledConversation {
  conversation_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  assigned_to: string | null;
  horas_parada: number;
}

export interface AttendanceMetrics {
  aguardando: number;
  em_andamento: number;
  sem_resposta: number;
  finalizados_hoje: number;
  /** Segundos; null quando ainda não há amostra. */
  tempo_medio_primeira_resposta: number | null;
  tempo_medio_atendimento: number | null;
  agentes_online: number;
  agentes_total: number;
  por_agente: AgentLoad[];
  serie_7_dias: { dia: string; novas: number }[];
  paradas: StalledConversation[];
}

const EMPTY: AttendanceMetrics = {
  aguardando: 0,
  em_andamento: 0,
  sem_resposta: 0,
  finalizados_hoje: 0,
  tempo_medio_primeira_resposta: null,
  tempo_medio_atendimento: null,
  agentes_online: 0,
  agentes_total: 0,
  por_agente: [],
  serie_7_dias: [],
  paradas: [],
};

export function useAttendanceMetrics(departmentId?: string | null, connectionId?: string | null) {
  const [metrics, setMetrics] = useState<AttendanceMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase().schema('whatsapp_hub');
    let { data, error: rpcError } = await supabase
      .rpc('attendance_dashboard', {
        p_department: departmentId ?? null,
        p_connection: connectionId ?? null,
      });

    // Durante um deploy, o frontend pode entrar no ar antes da migration que
    // adiciona p_connection. Mantém o dashboard disponível nesse intervalo;
    // a visão por número passa a valer assim que o schema novo estiver ativo.
    if (rpcError && (rpcError.code === 'PGRST202' || rpcError.message.includes('p_connection'))) {
      const legacy = await supabase.rpc('attendance_dashboard', {
        p_department: departmentId ?? null,
      });
      data = legacy.data;
      rpcError = legacy.error;
    }

    if (rpcError) {
      setError(rpcError.message);
      setMetrics(EMPTY);
    } else {
      setMetrics({ ...EMPTY, ...(data as Partial<AttendanceMetrics> | null) });
    }
    setLoading(false);
  }, [departmentId, connectionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { metrics, loading, error, reload };
}

// "2h 15min" / "45min" / "30s". Null vira travessão: sem amostra não é zero.
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}h ${rest}min` : `${h}h`;
}
