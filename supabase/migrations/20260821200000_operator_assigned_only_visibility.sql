-- Decisão de produto confirmada pelo usuário em 21/08/2026: operator só vê
-- (e só opera) as conversas atribuídas a ele — não o departamento inteiro.
-- Isso é o que docs/PLANO-HIERARQUIA.md (seção 3, "Acompanhar atendimentos")
-- sempre desenhou pro atendente, mas 20260821180000_conversations_department_rls.sql
-- tinha dado a ele o mesmo recorte do supervisor (departamento inteiro) por
-- ainda não haver decisão. Agora há.
--
-- supervisor continua vendo/operando o departamento inteiro (administra o
-- setor, distribui a fila). admin/super_admin inalterados (bypass via
-- sees_all_departments/is_super_admin). operator passa a exigir
-- assigned_to = auth.uid() — antes de ser atribuído (fila, sem assigned_to),
-- ele não vê a conversa; quem distribui é o supervisor ou o round-robin
-- automático (next_department_assignee).

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DROP POLICY IF EXISTS conversations_select ON whatsapp_hub.conversations;
CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated
  USING (
    (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (
      whatsapp_hub.sees_all_departments()
      OR (whatsapp_hub.current_user_role() = 'supervisor' AND department_id = whatsapp_hub.current_user_department())
      OR (whatsapp_hub.current_user_role() = 'operator' AND assigned_to = auth.uid())
    )
  );

DROP POLICY IF EXISTS conversations_write ON whatsapp_hub.conversations;
CREATE POLICY conversations_write ON whatsapp_hub.conversations
  FOR ALL TO authenticated
  USING (
    whatsapp_hub.can_operate()
    AND (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (
      whatsapp_hub.sees_all_departments()
      OR (whatsapp_hub.current_user_role() = 'supervisor' AND department_id = whatsapp_hub.current_user_department())
      OR (whatsapp_hub.current_user_role() = 'operator' AND assigned_to = auth.uid())
    )
  )
  WITH CHECK (
    whatsapp_hub.can_operate()
    AND (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (
      whatsapp_hub.sees_all_departments()
      OR (whatsapp_hub.current_user_role() = 'supervisor' AND department_id = whatsapp_hub.current_user_department())
      OR (whatsapp_hub.current_user_role() = 'operator' AND assigned_to = auth.uid())
    )
  );

DROP POLICY IF EXISTS messages_select ON whatsapp_hub.messages;
CREATE POLICY messages_select ON whatsapp_hub.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_hub.conversations c
       WHERE c.id = messages.conversation_id
         AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
         AND (
           whatsapp_hub.sees_all_departments()
           OR (whatsapp_hub.current_user_role() = 'supervisor' AND c.department_id = whatsapp_hub.current_user_department())
           OR (whatsapp_hub.current_user_role() = 'operator' AND c.assigned_to = auth.uid())
         )
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
         AND (
           whatsapp_hub.sees_all_departments()
           OR (whatsapp_hub.current_user_role() = 'supervisor' AND c.department_id = whatsapp_hub.current_user_department())
           OR (whatsapp_hub.current_user_role() = 'operator' AND c.assigned_to = auth.uid())
         )
    )
  )
  WITH CHECK (
    whatsapp_hub.can_operate()
    AND EXISTS (
      SELECT 1 FROM whatsapp_hub.conversations c
       WHERE c.id = messages.conversation_id
         AND (NOT whatsapp_hub.department_is_restricted(c.department_id) OR whatsapp_hub.is_super_admin())
         AND (
           whatsapp_hub.sees_all_departments()
           OR (whatsapp_hub.current_user_role() = 'supervisor' AND c.department_id = whatsapp_hub.current_user_department())
           OR (whatsapp_hub.current_user_role() = 'operator' AND c.assigned_to = auth.uid())
         )
    )
  );
