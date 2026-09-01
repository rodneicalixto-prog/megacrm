-- Onda 3 do pacote de atualização (PLANEJAMENTO.md): observabilidade da IA —
-- 👍/👎 nas respostas, custo/uso de tokens e histórico de versões do prompt.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Tokens, custo e feedback por mensagem (só relevante em sender_type='ai')
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.messages
  ADD COLUMN IF NOT EXISTS tokens_input  INT,
  ADD COLUMN IF NOT EXISTS tokens_output INT,
  ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS feedback      TEXT,
  -- Aponta pra ai_agent_config.id que gerou a resposta — hoje sempre a
  -- config singleton, mas já prepara terreno pro multi-perfil/A-B-C-D
  -- (quando ai_agent_config virar multi-linha, este campo correlaciona
  -- métricas por variante sem precisar de migration nova).
  ADD COLUMN IF NOT EXISTS ai_config_id  UUID REFERENCES whatsapp_hub.ai_agent_config(id) ON DELETE SET NULL;

ALTER TABLE whatsapp_hub.messages
  DROP CONSTRAINT IF EXISTS messages_feedback_chk;
ALTER TABLE whatsapp_hub.messages
  ADD CONSTRAINT messages_feedback_chk CHECK (feedback IS NULL OR feedback IN ('up','down'));

CREATE INDEX IF NOT EXISTS idx_messages_ai_config ON whatsapp_hub.messages(ai_config_id) WHERE ai_config_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Versionamento de prompt — snapshot antes de cada UPDATE em ai_agent_config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.ai_agent_config_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id      UUID NOT NULL REFERENCES whatsapp_hub.ai_agent_config(id) ON DELETE CASCADE,
  system_prompt  TEXT,
  temperature    REAL,
  max_tokens     INT,
  changed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_config_history_config
  ON whatsapp_hub.ai_agent_config_history(config_id, created_at DESC);

ALTER TABLE whatsapp_hub.ai_agent_config_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_config_history_select ON whatsapp_hub.ai_agent_config_history;
CREATE POLICY ai_agent_config_history_select ON whatsapp_hub.ai_agent_config_history
  FOR SELECT TO authenticated
  USING (whatsapp_hub.is_admin());

-- Sem policy de INSERT: só a trigger SECURITY DEFINER abaixo escreve aqui —
-- o histórico não pode ser forjado nem apagado pelo client.

CREATE OR REPLACE FUNCTION whatsapp_hub._snapshot_ai_agent_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  IF OLD.system_prompt IS DISTINCT FROM NEW.system_prompt
     OR OLD.temperature IS DISTINCT FROM NEW.temperature
     OR OLD.max_tokens IS DISTINCT FROM NEW.max_tokens
  THEN
    INSERT INTO whatsapp_hub.ai_agent_config_history (
      config_id, system_prompt, temperature, max_tokens, changed_by
    ) VALUES (
      OLD.id, OLD.system_prompt, OLD.temperature, OLD.max_tokens, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_ai_agent_config ON whatsapp_hub.ai_agent_config;
CREATE TRIGGER trg_snapshot_ai_agent_config
  BEFORE UPDATE ON whatsapp_hub.ai_agent_config
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._snapshot_ai_agent_config();
