-- Agente de IA passa a ser OPT-IN.
--
-- O default era `active_whatsapp = true`, herdado de quando se assumia que o
-- numero conectado era um numero comercial novo e todo mundo que escrevia era
-- lead. Com a rota nao-oficial, o numero conectado costuma ser um WhatsApp em
-- uso, com cliente antigo, fornecedor e conversa pessoal — e o agente respondia
-- todos eles no primeiro minuto depois do setup.
--
-- Ligar e um clique em Configuracoes -> Agente de IA. Desfazer um agente que
-- ja falou com 174 contatos nao e.
--
-- `is_active` continua true: ele nao e exposto na UI, quem gateia por canal sao
-- active_whatsapp / active_instagram.

SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.ai_agent_config
  ALTER COLUMN active_whatsapp SET DEFAULT false;

-- Desliga UMA VEZ nas instalacoes que ja existem. O bootstrap pula migration
-- ja marcada, entao em regime normal isto roda uma vez so; a marca em
-- _bootstrap_state e a garantia extra para o caso de a marca da migration ser
-- perdida (restore, replay manual) e o UPDATE reverter a escolha do usuario.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public._bootstrap_state WHERE step = 'ai_agent_opt_in'
  ) THEN
    UPDATE whatsapp_hub.ai_agent_config SET active_whatsapp = false;
    INSERT INTO public._bootstrap_state (step, completed_at, metadata)
    VALUES ('ai_agent_opt_in', now(), jsonb_build_object('reason', 'agente passa a ser opt-in'));
  END IF;
END $$;
