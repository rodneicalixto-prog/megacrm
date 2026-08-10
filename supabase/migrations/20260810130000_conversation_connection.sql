-- Um departamento pode ter MUITAS conexoes.
--
-- O desenho anterior assumia no maximo um numero "de fila" por departamento.
-- Na pratica ha departamento com 20 linhas, todas alimentando a mesma equipe.
-- O indice que impunha uma so esta errado e sai.
--
-- E isso obriga uma segunda mudanca: com varias linhas no mesmo departamento,
-- saber o departamento nao basta para responder. A resposta tem que sair pela
-- MESMA linha que recebeu — senao o contato escreve para um numero e e
-- respondido por outro. Entao a conversa passa a guardar a conexao.

SET search_path TO whatsapp_hub, public;

DROP INDEX IF EXISTS whatsapp_hub.department_connections_queue_key;

ALTER TABLE whatsapp_hub.conversations
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES whatsapp_hub.department_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_connection
  ON whatsapp_hub.conversations(connection_id);

-- Nome opcional para a linha aparecer legivel na interface ("Ponto 1",
-- "Recepcao 3") em vez do nome cru da instancia.
ALTER TABLE whatsapp_hub.department_connections
  ADD COLUMN IF NOT EXISTS label TEXT;
