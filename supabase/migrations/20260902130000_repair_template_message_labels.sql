CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- O payload bruto historico nao fica armazenado em messages, portanto nao e
-- possivel reconstruir o corpo de templates que ja foram gravados pelo fallback
-- antigo. Removemos o detalhe tecnico da Inbox; mensagens novas passam pelo
-- decoder corrigido e preservam corpo/rodape quando a Evolution os entrega.
UPDATE whatsapp_hub.messages
SET content = 'Mensagem interativa do WhatsApp'
WHERE content = '[Mensagem não suportada: templateMessage]';
