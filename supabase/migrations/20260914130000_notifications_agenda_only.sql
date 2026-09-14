-- Decisao do usuario (14/09/2026): o sininho de notificacoes e reservado
-- pra agenda (tarefa/reuniao atrasada, em andamento -- chamar atencao pra
-- checar a agenda do dia), nunca pra chegada de mensagem de WhatsApp. Isso
-- ja tinha ido e voltado ontem (20260913222507 desligou, 20260913222625
-- religou sem previa) -- agora desliga de vez tanto 'new_message' quanto
-- 'handoff' (ambos sao sinal de conversa, nao de agenda). sla_breach e
-- legal_task_overdue continuam intactos: ja sao alertas de prazo/tarefa.
--
-- Observacao: hoje nao existe nenhum gatilho de "reuniao/tarefa da agenda
-- atrasada" (revisado check-follow-ups e a tabela calendar_events) -- o
-- pedido de "chamar atencao pra agenda do dia" ainda nao tem mecanismo
-- proprio, isso e um gap separado a ser levantado com o usuario.

SET search_path TO whatsapp_hub, public;

DROP TRIGGER IF EXISTS on_inbound_notify ON whatsapp_hub.messages;
DROP TRIGGER IF EXISTS on_handoff_notify ON whatsapp_hub.conversations;

-- Limpa o que ja esta sentado na bandeja de todo mundo agora.
DELETE FROM whatsapp_hub.notifications WHERE type IN ('new_message', 'handoff');

NOTIFY pgrst, 'reload schema';
