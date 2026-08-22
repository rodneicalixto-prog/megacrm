-- Fase C item 12: esconder a linha do super_admin em app_users de quem não é
-- super_admin (docs/PLANO-HIERARQUIA.md seção 3: "Ver o usuário super_admin"
-- é ✅ só pra super_admin, ⬬ pros demais).
--
-- De brinde, a mesma classe de bug já corrigida várias vezes nesta rodada:
-- app_users_self_select comparava current_user_role() = 'admin' (literal),
-- então nem o próprio super_admin conseguia ver a lista de membros — só a
-- própria linha. TeamSettings.tsx (isOwner, corrigido em
-- 20260821180000_conversations_department_rls.sql) já libera a tela pro
-- super_admin; sem este fix a query ainda voltava vazia pra ele.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DROP POLICY IF EXISTS app_users_self_select ON whatsapp_hub.app_users;
CREATE POLICY app_users_self_select ON whatsapp_hub.app_users
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR whatsapp_hub.is_super_admin()
    OR (whatsapp_hub.current_user_role() = 'admin' AND role <> 'super_admin')
  );
