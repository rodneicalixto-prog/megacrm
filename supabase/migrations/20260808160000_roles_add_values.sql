-- Novos papeis: super_admin e supervisor.
--
-- MIGRATION SEPARADA DE PROPOSITO. `ALTER TYPE ... ADD VALUE` nao pode ter o
-- valor novo USADO na mesma transacao que o criou — qualquer INSERT, policy ou
-- comparacao com 'super_admin' aqui dentro falharia com "unsafe use of new
-- value". Quem usa os valores e a migration seguinte.
--
-- `operator` permanece: e o atendente. Renomear valor de enum em uso quebraria
-- os JWTs ja emitidos, que carregam role no app_metadata ate a sessao renovar.

SET search_path TO whatsapp_hub, public;

ALTER TYPE whatsapp_hub.tenant_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE whatsapp_hub.tenant_role ADD VALUE IF NOT EXISTS 'supervisor';
