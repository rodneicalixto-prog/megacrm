-- Correção de regressão: 20260913223426_strict_admin_visibility_supervisor_operator_only
-- (aplicada direto em produção, fora do fluxo git) tirou o "NOT" externo da
-- condição de admin/super_admin, trocando "esconder só quem está atribuído a
-- OUTRO admin/super_admin" por "só mostrar quem JÁ está atribuído a
-- supervisor/operador". Efeito colateral não intencional: toda conversa sem
-- responsável (fila) e todo dashboard (attendance_dashboard é SECURITY
-- INVOKER, herda esta mesma RLS) ficou invisível pra admin/super_admin em
-- QUALQUER departamento, não só no "Geral" (linha pessoal do dono, motivo
-- original da mudança). Restaura a versão de 20260913202917
-- (hide_admin_personal_conversations), que já resolvia o vazamento real
-- (Priscilla via a linha pessoal do super_admin) sem bloquear a fila.
--
-- Aplicada em produção em 14/09/2026 via MCP antes deste arquivo existir no
-- git — este arquivo só sincroniza o histórico de migrations com o que já
-- está rodando (achado ao investigar msgs chegando e não aparecendo no CRM).

SET search_path TO whatsapp_hub, public;

DROP POLICY IF EXISTS conversations_select ON whatsapp_hub.conversations;
CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated
  USING (
    (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (
      assigned_to = auth.uid()
      OR (
        whatsapp_hub.sees_all_departments()
        AND NOT (assigned_to IS NOT NULL AND whatsapp_hub.assignee_is_admin_tier(assigned_to))
      )
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
      assigned_to = auth.uid()
      OR (
        whatsapp_hub.sees_all_departments()
        AND NOT (assigned_to IS NOT NULL AND whatsapp_hub.assignee_is_admin_tier(assigned_to))
      )
      OR (whatsapp_hub.current_user_role() = 'supervisor' AND department_id = whatsapp_hub.current_user_department())
      OR (whatsapp_hub.current_user_role() = 'operator' AND assigned_to = auth.uid())
    )
  )
  WITH CHECK (
    whatsapp_hub.can_operate()
    AND (NOT whatsapp_hub.department_is_restricted(department_id) OR whatsapp_hub.is_super_admin())
    AND (
      assigned_to = auth.uid()
      OR (
        whatsapp_hub.sees_all_departments()
        AND NOT (assigned_to IS NOT NULL AND whatsapp_hub.assignee_is_admin_tier(assigned_to))
      )
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
           c.assigned_to = auth.uid()
           OR (
             whatsapp_hub.sees_all_departments()
             AND NOT (c.assigned_to IS NOT NULL AND whatsapp_hub.assignee_is_admin_tier(c.assigned_to))
           )
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
           c.assigned_to = auth.uid()
           OR (
             whatsapp_hub.sees_all_departments()
             AND NOT (c.assigned_to IS NOT NULL AND whatsapp_hub.assignee_is_admin_tier(c.assigned_to))
           )
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
           c.assigned_to = auth.uid()
           OR (
             whatsapp_hub.sees_all_departments()
             AND NOT (c.assigned_to IS NOT NULL AND whatsapp_hub.assignee_is_admin_tier(c.assigned_to))
           )
           OR (whatsapp_hub.current_user_role() = 'supervisor' AND c.department_id = whatsapp_hub.current_user_department())
           OR (whatsapp_hub.current_user_role() = 'operator' AND c.assigned_to = auth.uid())
         )
    )
  );

NOTIFY pgrst, 'reload schema';
