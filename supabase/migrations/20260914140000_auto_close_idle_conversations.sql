-- Decisao do usuario (14/09/2026): como boa parte do atendimento acontece
-- direto no celular (fora do CRM), o operador nao tem como clicar em
-- "Finalizar" na tela. Sem isso, conversa nenhuma nunca fecha por conta
-- propria e a fila/historico ficam poluidos com atendimentos que ja
-- acabaram na pratica. Regra: sem troca de mensagem (inbound OU outbound,
-- e isso que last_message_at reflete) por 2 horas, fecha automaticamente.
--
-- Nao fecha arquivadas (ja sairam do fluxo por outro motivo) nem quem ja
-- esta closed. Roda a cada 15 min -- 2h e o corte, nao a precisao do cron.

SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub.close_idle_conversations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  UPDATE whatsapp_hub.conversations
     SET status = 'closed',
         closed_at = now()
   WHERE status <> 'closed'
     AND archived = false
     AND last_message_at IS NOT NULL
     AND last_message_at <= now() - interval '2 hours';
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.close_idle_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.close_idle_conversations() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('wh-close-idle-conversations');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'wh-close-idle-conversations',
  '*/15 * * * *',
  $$SELECT whatsapp_hub.close_idle_conversations();$$
);
