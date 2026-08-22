-- Desagenda 3 jobs pg_cron que não deveriam estar rodando em produção:
--
--   - wh-check-template-status: aponta pra Edge Function `check-template-status`
--     que não existe mais (renomeada pra `sync-template-status`, hoje manual).
--     A migration 20260623120000_zernio_schema.sql já tentava desagendar isso,
--     mas o job segue ativo nesta instância (drift de produção) — confirmado
--     rodando a cada 5min contra uma função inexistente. `PERFORM
--     cron.unschedule` com EXCEPTION WHEN OTHERS ignora "job não existe", então
--     é seguro rodar de novo mesmo que já tenha sido desagendado em algum
--     ambiente.
--   - repurchase-predictions-daily / repurchase-dispatch-daily: o módulo
--     Vendas & Recompra está sendo removido do projeto (decisão registrada em
--     PLANEJAMENTO.md), mas os crons diários continuavam ativos e podiam
--     disparar mensagens de recompra reais para contatos antes do módulo sair
--     de fato da UI (achado do code review de 21/08/2026).

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DO $$
BEGIN
  PERFORM cron.unschedule('wh-check-template-status');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('repurchase-predictions-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('repurchase-dispatch-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;
