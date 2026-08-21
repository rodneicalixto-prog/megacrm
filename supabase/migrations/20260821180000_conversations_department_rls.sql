-- Fase C da hierarquia/departamentos, nunca implementada: conversations_select
-- e messages_select seguiam FOR SELECT TO authenticated USING (true) desde
-- 20260430120002_drop_multitenant.sql — qualquer usuário autenticado lia
-- qualquer conversa/mensagem, inclusive do departamento "Administração
-- Geral" (is_restricted), que deveria ser exclusivo do super_admin. Os
-- helpers pra isso (current_user_department, department_is_restricted,
-- sees_all_departments, is_super_admin) já existem desde
-- 20260808180000_hierarchy_roles.sql, mas nunca foram usados em nenhuma
-- policy.
--
-- De brinde, conversations_write/messages_write ainda filtravam
-- current_user_role() IN ('admin','operator') — resíduo de antes da fase de
-- hierarquia, sem supervisor nem super_admin na lista. Como o frontend
-- escreve direto nessas tabelas (pausar IA, marcar como lida, atribuir),
-- isso bloqueava supervisor E super_admin de operar conversas/mensagens via
-- RLS. Trocado por can_operate() (as 4 roles), com o mesmo recorte de
-- departamento do SELECT.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DROP POLICY IF EXISTS conversations_select ON whatsapp_hub.conversations;
CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated
  USING (
    (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (whatsapp_hub.sees_all_departments() OR department_id = whatsapp_hub.current_user_department())
  );

DROP POLICY IF EXISTS conversations_write ON whatsapp_hub.conversations;
CREATE POLICY conversations_write ON whatsapp_hub.conversations
  FOR ALL TO authenticated
  USING (
    whatsapp_hub.can_operate()
    AND (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (whatsapp_hub.sees_all_departments() OR department_id = whatsapp_hub.current_user_department())
  )
  WITH CHECK (
    whatsapp_hub.can_operate()
    AND (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (whatsapp_hub.sees_all_departments() OR department_id = whatsapp_hub.current_user_department())
  );

DROP POLICY IF EXISTS messages_select ON whatsapp_hub.messages;
CREATE POLICY messages_select ON whatsapp_hub.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_hub.conversations c
       WHERE c.id = messages.conversation_id
         AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
         AND (whatsapp_hub.sees_all_departments() OR c.department_id = whatsapp_hub.current_user_department())
    )
  );

DROP POLICY IF EXISTS messages_write ON whatsapp_hub.messages;
CREATE POLICY messages_write ON whatsapp_hub.messages
  FOR ALL TO authenticated
  USING (
    whatsapp_hub.can_operate()
    AND EXISTS (
      SELECT 1 FROM whatsapp_hub.conversations c
       WHERE c.id = messages.conversation_id
         AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
         AND (whatsapp_hub.sees_all_departments() OR c.department_id = whatsapp_hub.current_user_department())
    )
  )
  WITH CHECK (
    whatsapp_hub.can_operate()
    AND EXISTS (
      SELECT 1 FROM whatsapp_hub.conversations c
       WHERE c.id = messages.conversation_id
         AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
         AND (whatsapp_hub.sees_all_departments() OR c.department_id = whatsapp_hub.current_user_department())
    )
  );
