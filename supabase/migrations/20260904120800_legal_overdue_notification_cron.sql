-- Módulo Jurídico — aviso de tarefa atrasada via sino de notificação
-- existente (WhatsApp pro celular do responsável foi avaliado e descartado
-- por ora — exigiria telefone cadastrado + consentimento + mecanismo de
-- disparo interno que não existe hoje).
--
-- Dedup no mesmo padrão de check-sla: só notifica se não existir uma
-- notificação 'legal_task_overdue' NÃO LIDA pra aquela tarefa — reabre
-- sozinho quando o operador marca como lida e a tarefa segue atrasada
-- (nagging desejado). Por isso `notifications` ganha uma FK opcional pra
-- tarefa jurídica, e não uma coluna de "última vez que avisei" separada.
SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.notifications
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES whatsapp_hub.legal_case_tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_task ON whatsapp_hub.notifications (task_id) WHERE task_id IS NOT NULL;

DO $$
BEGIN
  PERFORM cron.unschedule('wh-legal-overdue-tasks');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

-- 15 min: menos urgente que SLA de atendimento (5min) — prazo de tarefa
-- jurídica é medido em dias/horas, não minutos.
SELECT cron.schedule(
  'wh-legal-overdue-tasks',
  '*/15 * * * *',
  $cron$SELECT whatsapp_hub._cron_invoke_edge('check-legal-overdue-tasks')$cron$
);
