-- Horário de atendimento individualizado por departamento e por usuário
-- (itens 9 e 10 do feedback do usuário, já catalogados em PLANEJAMENTO.md
-- desde a sessão de hierarquia/departamentos).
--
-- Hoje `business_hours`/`out_of_hours_message` vivem só no singleton
-- `whatsapp_hub.app_settings` (id=1). Este singleton continua existindo como
-- o "padrão global" — departamento e usuário ganham colunas NULAS que, ao
-- estarem preenchidas, sobrescrevem o global. NULL = "usa o horário do nível
-- acima" (usuário → departamento → global), sem precisar copiar o valor do
-- singleton pra cada linha existente.
--
-- Sem mudança de RLS: `departments_write` já é admin/super_admin-only (cobre
-- as novas colunas); a leitura de `app_users` já é aberta pro próprio dono
-- da linha via `user_id = auth.uid()`, e a escrita da própria linha já é
-- permitida por `app_users_self_presence_update` (mesma policy usada hoje
-- pro heartbeat de presença — sem guard de coluna, mas já existe um trigger
-- que bloqueia auto-promoção de role por essa mesma policy).

SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.departments
  ADD COLUMN IF NOT EXISTS business_hours JSONB,
  ADD COLUMN IF NOT EXISTS out_of_hours_message TEXT;

ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS business_hours JSONB,
  ADD COLUMN IF NOT EXISTS out_of_hours_message TEXT;

-- De brinde, achado ao mexer aqui: `app_users_admin_write` comparava
-- literalmente `current_user_role() = 'admin'`, o mesmo bug de
-- "super_admin excluído" corrigido várias vezes nesta sessão (nav guards,
-- policies de campanhas/vendas/IA) — o dono da instalação não conseguia
-- editar o horário de atendimento de outro usuário (nem qualquer outro
-- campo de app_users) por essa policy.
DROP POLICY IF EXISTS app_users_admin_write ON whatsapp_hub.app_users;
CREATE POLICY app_users_admin_write ON whatsapp_hub.app_users
  FOR ALL TO authenticated
  USING (whatsapp_hub.current_user_role() IN ('super_admin', 'admin'))
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin', 'admin'));
