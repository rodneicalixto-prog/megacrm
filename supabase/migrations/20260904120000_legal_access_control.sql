-- Módulo Jurídico — controle de acesso.
--
-- Acesso restrito a super_admin, admin, e supervisor de departamentos
-- específicos (tipicamente RH e DP). `departments` não tem coluna de
-- tipo/código, só `name` livre — fixar `name IN ('RH','DP')` no SQL seria
-- frágil (quebra se o setor tiver outro nome nesta instalação). Em vez
-- disso, uma flag por departamento, configurável pelo admin na tela de
-- Setores já existente (nenhuma UI nova aqui).
--
-- Gate é PLANO, não por linha: um supervisor autorizado enxerga todos os
-- processos jurídicos (de qualquer departamento com a flag ligada), não só
-- os do próprio setor — confirmado contra o modelo visual aprovado, que
-- mistura processos de RH e DP na mesma lista para o mesmo usuário.
SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.departments
  ADD COLUMN IF NOT EXISTS grants_legal_access boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION whatsapp_hub.can_access_legal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
  SELECT whatsapp_hub.is_admin()
    OR (
      whatsapp_hub.current_user_role() = 'supervisor'
      AND EXISTS (
        SELECT 1 FROM whatsapp_hub.departments d
        WHERE d.id = whatsapp_hub.current_user_department()
          AND d.grants_legal_access
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.can_access_legal() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION whatsapp_hub.can_access_legal() TO authenticated, service_role;
