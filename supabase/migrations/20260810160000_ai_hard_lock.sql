-- Trava dura da IA: a decisao passa a ser tomada ANTES do disparo.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Antes, o trigger invocava process-ai-message em toda mensagem inbound e a
-- funcao e que lia is_active e desistia. Desligada, a IA ainda acordava a cada
-- mensagem, gastava invocacao e pg_net, e bastava um bug de leitura da flag
-- para ela responder. Agora, desligada, nada dispara.
CREATE OR REPLACE FUNCTION whatsapp_hub._on_inbound_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
declare
  v_ativa boolean;
begin
  if NEW.direction <> 'inbound'
     or NEW.sender_type <> 'contact'
     or coalesce(NEW.is_private_note, false) = true
  then
    return NEW;
  end if;

  select a.is_active into v_ativa from whatsapp_hub.ai_agent_config a limit 1;

  -- Sem linha de config = sem agente. O default e NAO responder: uma IA que
  -- fala por engano numa conversa real nao tem desfazer.
  if coalesce(v_ativa, false) = false then
    return NEW;
  end if;

  perform whatsapp_hub._invoke_edge_with_body(
    'process-ai-message',
    jsonb_build_object('message_id', NEW.id)
  );
  return NEW;
end;
$$;

UPDATE whatsapp_hub.ai_agent_config SET is_active = false;
