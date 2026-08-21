-- Religa RLS nas tabelas legadas de multi-tenant (whatsapp_hub.tenants,
-- tenant_settings, tenant_credentials, tenant_members) que sobraram em
-- produção da fase pré-OSS: a migration 20260430120002_drop_multitenant.sql
-- fez DROP de tenants/tenant_settings/tenant_credentials e RENAME de
-- tenant_members → app_users no schema do repositório, mas o banco de
-- produção (lstbxeaasyysboavdati) divergiu dessa migration e ainda tem as
-- quatro tabelas, com RLS desabilitado — expostas a anon/authenticated via
-- a anon key. Nenhuma delas é lida ou escrita por código atual (confirmado:
-- zero referências fora de migrations já superadas); a correção é fechar o
-- acesso sem adicionar policy nenhuma, no mesmo padrão de
-- public.app_settings / public._bootstrap_state (RLS on, zero policies =
-- só service role acessa).

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

ALTER TABLE IF EXISTS whatsapp_hub.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS whatsapp_hub.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS whatsapp_hub.tenant_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS whatsapp_hub.tenant_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON whatsapp_hub.tenants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON whatsapp_hub.tenant_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON whatsapp_hub.tenant_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON whatsapp_hub.tenant_members FROM PUBLIC, anon, authenticated;
