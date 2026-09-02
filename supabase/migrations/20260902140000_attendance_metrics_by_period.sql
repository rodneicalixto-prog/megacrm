CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DROP FUNCTION IF EXISTS whatsapp_hub.attendance_dashboard(UUID, UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION whatsapp_hub.attendance_dashboard(
  p_department UUID DEFAULT NULL,
  p_connection UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'America/Sao_Paulo',
  p_stalled_hours INT DEFAULT 24,
  p_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_today_start TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE p_timezone) AT TIME ZONE p_timezone;
  v_month_start TIMESTAMPTZ := date_trunc('month', COALESCE(p_month, (now() AT TIME ZONE p_timezone)::date)::timestamp) AT TIME ZONE p_timezone;
  v_month_end TIMESTAMPTZ := v_month_start + INTERVAL '1 month';
  v_result JSONB;
BEGIN
  WITH conv AS (
    SELECT c.*
      FROM whatsapp_hub.conversations c
     WHERE (p_department IS NULL OR c.department_id = p_department)
       AND (p_connection IS NULL OR c.connection_id = p_connection)
       AND c.archived = false
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id, m.direction, m.created_at
      FROM whatsapp_hub.messages m
      JOIN conv ON conv.id = m.conversation_id
     WHERE m.is_private_note = false
     ORDER BY m.conversation_id, m.created_at DESC
  ),
  first_pair AS (
    SELECT c.id,
           (SELECT MIN(m.created_at) FROM whatsapp_hub.messages m
             WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS first_in,
           (SELECT MIN(m.created_at) FROM whatsapp_hub.messages m
             WHERE m.conversation_id = c.id AND m.direction = 'outbound'
               AND m.sender_type <> 'ai' AND m.is_private_note = false) AS first_out
      FROM conv c
  )
  SELECT jsonb_build_object(
    'aguardando', (SELECT COUNT(*) FROM conv WHERE status <> 'closed' AND assigned_to IS NULL),
    'em_andamento', (SELECT COUNT(*) FROM conv WHERE status <> 'closed' AND assigned_to IS NOT NULL),
    'sem_resposta', (
      SELECT COUNT(*) FROM conv c JOIN last_msg l ON l.conversation_id = c.id
       WHERE c.status <> 'closed' AND l.direction = 'inbound'
    ),
    'finalizados_hoje', (
      SELECT COUNT(*) FROM conv WHERE status = 'closed' AND closed_at >= v_today_start
    ),
    'tempo_medio_primeira_resposta_hoje', (
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (first_out - first_in))))
        FROM first_pair
       WHERE first_in >= v_today_start AND first_in < v_today_start + INTERVAL '1 day'
         AND first_out IS NOT NULL AND first_out >= first_in
    ),
    'tempo_medio_primeira_resposta_periodo', (
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (first_out - first_in))))
        FROM first_pair
       WHERE first_in >= v_month_start AND first_in < v_month_end
         AND first_out IS NOT NULL AND first_out >= first_in
    ),
    'tempo_medio_primeira_resposta', (
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (first_out - first_in))))
        FROM first_pair WHERE first_in IS NOT NULL AND first_out IS NOT NULL AND first_out >= first_in
    ),
    'tempo_medio_atendimento', (
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - created_at))))
        FROM conv WHERE status = 'closed' AND closed_at IS NOT NULL
    ),
    'agentes_online', (
      SELECT COUNT(*) FROM whatsapp_hub.app_users
       WHERE is_online = true AND (p_department IS NULL OR department_id = p_department)
    ),
    'agentes_total', (
      SELECT COUNT(*) FROM whatsapp_hub.app_users
       WHERE (p_department IS NULL OR department_id = p_department)
    ),
    'por_agente', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'abertas')::INT DESC)
        FROM (
          SELECT jsonb_build_object(
                   'user_id', u.user_id,
                   'is_online', u.is_online,
                   'abertas', COUNT(c.id) FILTER (WHERE c.status <> 'closed'),
                   'fechadas_hoje', COUNT(c.id) FILTER (WHERE c.status = 'closed' AND c.closed_at >= v_today_start)
                 ) AS x
            FROM whatsapp_hub.app_users u
            LEFT JOIN conv c ON c.assigned_to = u.user_id
           WHERE (p_department IS NULL OR u.department_id = p_department)
           GROUP BY u.user_id, u.is_online
        ) s
    ), '[]'::jsonb),
    'serie_7_dias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dia', d.dia, 'novas', COALESCE(n.total, 0)) ORDER BY d.dia)
        FROM (
          SELECT generate_series((v_today_start - INTERVAL '6 days')::date, v_today_start::date, INTERVAL '1 day')::date AS dia
        ) d
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE p_timezone)::date AS dia, COUNT(*) AS total
            FROM conv
           WHERE created_at >= v_today_start - INTERVAL '6 days'
           GROUP BY 1
        ) n ON n.dia = d.dia
    ), '[]'::jsonb),
    'paradas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'conversation_id', c.id,
               'contact_name', ct.name,
               'contact_phone', ct.phone,
               'assigned_to', c.assigned_to,
               'horas_parada', ROUND(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600)
             ) ORDER BY l.created_at ASC)
        FROM conv c
        JOIN last_msg l ON l.conversation_id = c.id
        JOIN whatsapp_hub.contacts ct ON ct.id = c.contact_id
       WHERE c.status <> 'closed' AND l.direction = 'inbound'
         AND l.created_at < now() - make_interval(hours => p_stalled_hours)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION whatsapp_hub.attendance_dashboard(UUID, UUID, TEXT, INT, DATE) TO authenticated;
