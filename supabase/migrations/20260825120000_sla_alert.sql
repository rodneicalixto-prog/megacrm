-- Onda 2 do pacote de atualização (PLANEJAMENTO.md): alerta de SLA — avisa
-- quando um lead está esperando resposta humana há muito tempo. Mesmo padrão
-- de cron + Edge Function já usado por check-follow-ups.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- 'sla_breach' precisa existir antes de qualquer INSERT que o use — feito numa
-- migration própria (ADD VALUE não pode ser usado na mesma transação em que é
-- lido); a única leitura é o INSERT dentro da Edge Function check-sla, que só
-- roda depois do deploy, então não há problema de ordenação aqui.
ALTER TYPE whatsapp_hub.notification_type ADD VALUE IF NOT EXISTS 'sla_breach';

-- Config: reaproveita o singleton app_settings (mesmo modelo de business_hours
-- — um valor só para a instância, não por departamento; alinhar com uma
-- eventual config por setor é decisão de produto separada).
ALTER TABLE whatsapp_hub.app_settings
  ADD COLUMN IF NOT EXISTS sla_minutes INT NOT NULL DEFAULT 15;

-- Cron a cada 5 minutos — mais frequente que check-follow-ups (15min) porque
-- SLA de atendimento é medido em minutos, não em horas.
DO $$
BEGIN
  PERFORM cron.unschedule('wh-check-sla');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'wh-check-sla',
  '*/5 * * * *',
  $cron$SELECT whatsapp_hub._cron_invoke_edge('check-sla')$cron$
);
