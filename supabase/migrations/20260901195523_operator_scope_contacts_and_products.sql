-- Migration retroativa: registra em código duas mudanças de RLS que foram
-- aplicadas direto em produção em 01/09/2026 (project lstbxeaasyysboavdati,
-- migration remota "operator_scope_contacts_and_products", sem arquivo
-- commitado até agora — ver ISSUES.md "Migration drift"). Texto conferido
-- contra a definição real de pg_policies em produção; sem mudança de
-- comportamento, só o registro do que já está rodando.
SET search_path TO whatsapp_hub, public;

-- contacts_select (definida em 20260430120002_drop_multitenant.sql) era
-- `USING (true)` — qualquer autenticado lia todos os contatos, sem recorte
-- por departamento. Passa a seguir o mesmo modelo de "sees_all_departments()
-- OU dono/participante do departamento da conversa" já usado em
-- conversations_select (20260821180000_conversations_department_rls.sql).
DROP POLICY IF EXISTS contacts_select ON whatsapp_hub.contacts;
CREATE POLICY contacts_select ON whatsapp_hub.contacts
  FOR SELECT TO authenticated
  USING (
    whatsapp_hub.sees_all_departments()
    OR EXISTS (
      SELECT 1 FROM whatsapp_hub.conversations c
      WHERE c.contact_id = contacts.id
        AND (
          NOT whatsapp_hub.department_is_restricted(c.department_id)
          OR whatsapp_hub.is_super_admin()
        )
        AND (
          (whatsapp_hub.current_user_role() = 'supervisor' AND c.department_id = whatsapp_hub.current_user_department())
          OR (whatsapp_hub.current_user_role() = 'operator' AND c.assigned_to = auth.uid())
        )
    )
  );

-- products_write (definida em 20260711160000_custom_pipelines_and_lead_fields.sql)
-- checava `current_user_role() IN ('admin','operator')` — deixava operator
-- escrever produtos, papel pensado pro dia a dia de atendimento, não pra
-- catálogo. Passa a exigir sees_all_departments() (admin/super_admin).
DROP POLICY IF EXISTS products_write ON whatsapp_hub.products;
CREATE POLICY products_write ON whatsapp_hub.products
  FOR ALL TO authenticated
  USING      (whatsapp_hub.sees_all_departments())
  WITH CHECK (whatsapp_hub.sees_all_departments());
