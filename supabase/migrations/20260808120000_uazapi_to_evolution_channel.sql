-- Troca da rota nao-oficial: Uazapi -> Evolution API.
--
-- O `channel` da conversa guarda o nome do provedor e decide por onde a
-- resposta sai. Com o adapter Uazapi removido, conversas que ficassem em
-- 'uazapi' nao teriam mais por onde responder. Renomeia para 'evolution'.
--
-- Idempotente: rodar de novo nao faz nada. Instalacao nova nao tem linha
-- alguma para atualizar.

SET search_path TO whatsapp_hub;

UPDATE whatsapp_hub.conversations
   SET channel = 'evolution'
 WHERE channel = 'uazapi';

-- Ids de mensagem eram prefixados com o nome do provedor.
UPDATE whatsapp_hub.messages
   SET zernio_message_id = 'evolution:' || substring(zernio_message_id FROM 8)
 WHERE zernio_message_id LIKE 'uazapi:%';
