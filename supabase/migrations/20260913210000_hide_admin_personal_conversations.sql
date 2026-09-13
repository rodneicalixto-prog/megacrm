-- Decisão de produto confirmada pelo usuário em 13/09/2026: admin não deve
-- ver a linha pessoal (conversa via department_positions com position_id
-- preenchido, ver CLAUDE.md seção "Evolution") de outro admin/super_admin,
-- e super_admin não deve ver a linha pessoal de admin (nem de outro
-- super_admin). Achado real: um admin (Priscilla) estava enxergando as
-- conversas da linha pessoal do super_admin via conversations_select
-- (20260821200000_operator_assigned_only_visibility.sql), que dá bypass
-- total de departamento pra quem sees_all_departments() (admin +
-- super_admin) sem olhar pra quem é o assigned_to.
--
-- Escopo confirmado (não mexe no resto):
-- - admin/super_admin continuam vendo a fila do departamento (assigned_to
--   NULL) e as conversas já atribuídas a supervisor/operador, em qualquer
--   departamento não restrito — como hoje, é assim que administram e
--   distribuem atendimento.
-- - Só fica escondida a conversa cujo assigned_to é OUTRO admin/super_admin
--   (a própria conversa pessoal continua visível pra quem é dono dela).
-- - supervisor/operator inalterados: supervisor continua com o
--   departamento inteiro (fila + operadores), operator só com assigned_to
--   = auth.uid().
--
-- Helper novo porque current_user_department()/department_is_restricted()
-- só respondem sobre o usuário logado (auth.uid()) — aqui precisamos saber
-- o role de OUTRO usuário (o assigned_to da conversa), e app_users_select
-- (20260821190000_app_users_hide_super_admin.sql) esconde a linha do
-- super_admin de quem não é super_admin. Sem SECURITY DEFINER, a subquery
-- não enxergaria a role de um super_admin e a checagem falharia sempre pra
-- ele (tratando a conversa dele como se fosse de operador).

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub.assignee_is_admin_tier(p_assigned_to UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin') FROM whatsapp_hub.app_users WHERE user_id = p_assigned_to),
    false
  );
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.assignee_is_admin_tier(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.assignee_is_admin_tier(UUID) TO authenticated;

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
