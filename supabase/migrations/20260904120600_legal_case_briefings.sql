-- Módulo Jurídico — histórico versionado do briefing (contracapa do
-- processo), gerado pela IA.
--
-- Append-only de propósito: cada novo anexo, mensagem ou mudança de status
-- pode gerar uma versão nova, mas nenhuma versão anterior é sobrescrita —
-- é a linha do tempo do briefing do modelo visual. Por isso não existe
-- policy de INSERT nem de UPDATE/DELETE para o client: a única porta de
-- entrada é a RPC abaixo, que numera a versão de forma segura contra corrida
-- (ex.: anexo novo e mensagem nova quase simultâneos) e confere
-- can_access_legal() no corpo — SECURITY DEFINER bypassa RLS, então o
-- controle de acesso tem que ser explícito na function, mesmo padrão de
-- get_or_create_internal_conversation.
--
-- A geração de verdade (chamar o LLM, montar o texto) é responsabilidade de
-- uma Edge Function/frontend chamando esta RPC depois — um trigger de banco
-- nunca deve fazer chamada de rede síncrona dentro da transação do usuário.
SET search_path TO whatsapp_hub, public;

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.legal_briefing_trigger_type AS ENUM (
    'manual',
    'versao_inicial',
    'novo_anexo',
    'nova_mensagem',
    'status_alterado',
    'tarefa_concluida',
    'sentenca_ou_decisao'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_hub.legal_case_briefings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES whatsapp_hub.legal_cases(id) ON DELETE CASCADE,
  version        int NOT NULL,
  trigger_type   whatsapp_hub.legal_briefing_trigger_type NOT NULL,
  trigger_label  text,
  summary_text   text NOT NULL,
  classification text,
  clt_refs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  cct_notes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  precedents     jsonb NOT NULL DEFAULT '[]'::jsonb,
  defense_ideas  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- NULL quando gerado pela IA — só populado quando um humano registra a
  -- versão manualmente.
  generated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_case_briefings_version_unique UNIQUE (case_id, version)
);

CREATE INDEX IF NOT EXISTS legal_case_briefings_case_idx ON whatsapp_hub.legal_case_briefings (case_id, version DESC);

CREATE OR REPLACE FUNCTION whatsapp_hub.append_legal_case_briefing(
  p_case_id        uuid,
  p_trigger_type   whatsapp_hub.legal_briefing_trigger_type,
  p_trigger_label  text,
  p_summary_text   text,
  p_classification text DEFAULT NULL,
  p_clt_refs       jsonb DEFAULT '[]'::jsonb,
  p_cct_notes      jsonb DEFAULT '[]'::jsonb,
  p_precedents     jsonb DEFAULT '[]'::jsonb,
  p_defense_ideas  jsonb DEFAULT '[]'::jsonb,
  p_generated_by   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_version int;
  v_id      uuid;
BEGIN
  IF NOT whatsapp_hub.can_access_legal() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Trava por processo, não pela leitura das linhas existentes: evita que
  -- duas chamadas quase simultâneas (ex.: anexo novo e mensagem nova) tirem
  -- o mesmo MAX(version) antes de qualquer uma commitar.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_case_id::text, 0));

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM whatsapp_hub.legal_case_briefings WHERE case_id = p_case_id;

  INSERT INTO whatsapp_hub.legal_case_briefings (
    case_id, version, trigger_type, trigger_label, summary_text,
    classification, clt_refs, cct_notes, precedents, defense_ideas, generated_by
  ) VALUES (
    p_case_id, v_version, p_trigger_type, p_trigger_label, p_summary_text,
    p_classification, p_clt_refs, p_cct_notes, p_precedents, p_defense_ideas, p_generated_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.append_legal_case_briefing(
  uuid, whatsapp_hub.legal_briefing_trigger_type, text, text, text, jsonb, jsonb, jsonb, jsonb, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.append_legal_case_briefing(
  uuid, whatsapp_hub.legal_briefing_trigger_type, text, text, text, jsonb, jsonb, jsonb, jsonb, uuid
) TO authenticated, service_role;

-- Denormaliza a versão mais nova em legal_cases, pra lista/card renderizar
-- sem precisar de subquery MAX(version) toda vez.
CREATE OR REPLACE FUNCTION whatsapp_hub._sync_legal_case_latest_briefing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE whatsapp_hub.legal_cases
    SET summary = NEW.summary_text,
        classification = COALESCE(NEW.classification, legal_cases.classification),
        updated_at = now()
    WHERE id = NEW.case_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_case_briefings_sync_latest ON whatsapp_hub.legal_case_briefings;
CREATE TRIGGER legal_case_briefings_sync_latest
  AFTER INSERT ON whatsapp_hub.legal_case_briefings
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._sync_legal_case_latest_briefing();

ALTER TABLE whatsapp_hub.legal_case_briefings ENABLE ROW LEVEL SECURITY;

-- Só SELECT para o client — toda escrita passa pela RPC acima.
CREATE POLICY legal_case_briefings_select ON whatsapp_hub.legal_case_briefings
  FOR SELECT TO authenticated
  USING (whatsapp_hub.can_access_legal());

GRANT SELECT ON whatsapp_hub.legal_case_briefings TO authenticated;

ALTER TABLE whatsapp_hub.legal_case_briefings REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_hub.legal_case_briefings;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
