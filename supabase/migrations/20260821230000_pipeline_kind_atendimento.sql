-- Pedido do usuário: a criação de novos funis deve deixar escolher se é
-- financeiro/comercial ou de atendimento — hoje todo funil novo nasce
-- 'comercial' na marra (usePipeline.ts hardcodeia `kind: 'comercial'` no
-- insert), sem nunca expor a escolha.
--
-- MIGRATION SEPARADA DE PROPÓSITO (mesmo motivo de 20260808160000): ALTER
-- TYPE ... ADD VALUE não pode ter o valor novo USADO na mesma transação que
-- o criou. Quem usa 'atendimento' (guard nos triggers de venda, UI) vem na
-- migration seguinte.

SET search_path TO whatsapp_hub, public;

ALTER TYPE whatsapp_hub.crm_pipeline_kind ADD VALUE IF NOT EXISTS 'atendimento';
