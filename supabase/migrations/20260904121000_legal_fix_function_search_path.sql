-- Módulo Jurídico — corrige search_path mutável nas 4 funções de trigger
-- (achado real do get_advisors depois de aplicar as migrations anteriores;
-- os outros achados — tabelas legal_* visíveis no GraphQL, RPCs
-- SECURITY DEFINER chamáveis por authenticated — são o padrão esperado do
-- resto do repositório, a RLS/checagem interna é o gate de verdade).
SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub._touch_legal_case_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub._touch_legal_case_task_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub._bump_legal_case_last_message()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  UPDATE whatsapp_hub.legal_cases
    SET last_message_at = NEW.created_at
    WHERE id = NEW.case_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub._sync_legal_case_latest_briefing()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  UPDATE whatsapp_hub.legal_cases
    SET summary = NEW.summary_text,
        classification = COALESCE(NEW.classification, legal_cases.classification),
        updated_at = now()
    WHERE id = NEW.case_id;
  RETURN NEW;
END;
$$;
