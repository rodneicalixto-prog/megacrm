-- Correcao urgente (14/09/2026): "em_andamento"/"aguardando" usavam
-- assigned_to como proxy de "tem humano cuidando" -- mas boa parte do
-- atendimento acontece direto no celular (isFromMe em whatsapp-inbound),
-- que muda `status` para human_active e NUNCA seta assigned_to (isso
-- depende de department_positions, ainda em cadastro). Resultado real:
-- 77 de 101 conversas de Recrutamento Humano ja tinham resposta humana e
-- apareciam como "aguardando" pra sempre -- dashboard dizia que ninguem
-- estava atendendo quando estava. `status` e o sinal correto e ja
-- reflete a realidade hoje, sem depender de nenhum cadastro adicional.

SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub.attendance_dashboard(
  p_department UUID    DEFAULT NULL,
  p_timezone   TEXT    DEFAULT 'America/Sao_Paulo',
  p_stalled_hours INT  DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_today_start TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE p_timezone) AT TIME ZONE p_timezone;
  v_result JSONB;
BEGIN
  WITH conv AS (
    SELECT c.*
      FROM whatsapp_hub.conversations c
     WHERE (p_department IS NULL OR c.department_id = p_department)
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
    -- Fila: aberta e a IA ainda cuida (ninguem humano assumiu, via CRM ou celular).
    'aguardando', (SELECT COUNT(*) FROM conv WHERE status = 'ai_active'),
    -- Em andamento: humano ativo agora -- sinal e status, nao assigned_to
    -- (que fica NULL quando a resposta veio do celular, fora do CRM).
    'em_andamento', (SELECT COUNT(*) FROM conv WHERE status = 'human_active'),
    -- Sem resposta: a ultima palavra foi do contato.
    'sem_resposta', (
      SELECT COUNT(*) FROM conv c JOIN last_msg l ON l.conversation_id = c.id
       WHERE c.status <> 'closed' AND l.direction = 'inbound'
    ),
    'finalizados_hoje', (
      SELECT COUNT(*) FROM conv WHERE status = 'closed' AND closed_at >= v_today_start
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
      SELECT jsonb_agg(jsonb_build_object('dia', d.dia, 'novas', COALESCE(n.total, 0))
                       ORDER BY d.dia)
        FROM (
          SELECT generate_series(
                   (v_today_start - INTERVAL '6 days')::date, v_today_start::date, INTERVAL '1 day'
                 )::date AS dia
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
       WHERE c.status <> 'closed'
         AND l.direction = 'inbound'
         AND l.created_at < now() - make_interval(hours => p_stalled_hours)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION whatsapp_hub.attendance_dashboard(UUID, TEXT, INT) TO authenticated;
