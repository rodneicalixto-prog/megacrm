-- 'legal_task_overdue' precisa existir antes de qualquer INSERT que o use —
-- migration própria, sem nenhuma outra DDL/DML junto (ADD VALUE não pode ser
-- lido na mesma transação em que é criado; mesma regra documentada em
-- 20260825120000_sla_alert.sql). A única leitura é o INSERT dentro da Edge
-- Function check-legal-overdue-tasks, que só roda pós-deploy.
SET search_path TO whatsapp_hub, public;

ALTER TYPE whatsapp_hub.notification_type ADD VALUE IF NOT EXISTS 'legal_task_overdue';
