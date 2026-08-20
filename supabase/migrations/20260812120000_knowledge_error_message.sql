CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Hoje status='error' não carrega motivo nenhum: o operador vê o badge
-- "Erro" e não tem como saber se é chave de API inválida, sem saldo, ou PDF
-- sem texto extraível. Coluna nullable — populada pelo process-knowledge no
-- fail() e limpa quando o reprocessamento tem sucesso.
ALTER TABLE whatsapp_hub.knowledge_base
  ADD COLUMN IF NOT EXISTS error_message TEXT;
