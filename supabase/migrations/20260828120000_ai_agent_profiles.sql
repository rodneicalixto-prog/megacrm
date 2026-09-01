-- Onda 4 (PLANEJAMENTO.md): múltiplos perfis de IA + teste A/B/C/D.
--
-- ai_agent_config deixa de ser singleton (UNIQUE INDEX ON ((true))) e passa a
-- aceitar várias linhas — cada uma é um "perfil" de IA com seu próprio
-- system_prompt/model/temperature. process-ai-message escolhe o perfil ativo
-- via hash determinístico de contact_id contra traffic_pct acumulado, para
-- que o mesmo contato sempre caia na mesma variante (comparação justa, sem
-- confundir o lead trocando de personalidade no meio da conversa).

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

DROP INDEX IF EXISTS whatsapp_hub.ai_agent_config_singleton;

ALTER TABLE whatsapp_hub.ai_agent_config
  ADD COLUMN IF NOT EXISTS name         TEXT NOT NULL DEFAULT 'Principal',
  ADD COLUMN IF NOT EXISTS variant_key  TEXT,
  ADD COLUMN IF NOT EXISTS traffic_pct  INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_control   BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE whatsapp_hub.ai_agent_config
  ADD CONSTRAINT ai_agent_config_traffic_pct_chk CHECK (traffic_pct BETWEEN 0 AND 100);

-- variant_key identifica a variante nas métricas mesmo se o nome mudar
-- depois; gerado uma vez a partir do id se ainda não tiver sido definido.
UPDATE whatsapp_hub.ai_agent_config
   SET variant_key = 'control-' || substr(id::text, 1, 8)
 WHERE variant_key IS NULL;

ALTER TABLE whatsapp_hub.ai_agent_config
  ALTER COLUMN variant_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_config_variant_key_key
  ON whatsapp_hub.ai_agent_config (variant_key);

COMMENT ON COLUMN whatsapp_hub.ai_agent_config.traffic_pct IS
  'Percentual do tráfego elegível (por canal) roteado para este perfil. A soma dos perfis ativos de um canal deveria somar 100, mas não é enforced em SQL — a UI (AIAgentSettings) avisa quando não bate.';
COMMENT ON COLUMN whatsapp_hub.ai_agent_config.is_control IS
  'Marca o perfil "padrão"/controle na comparação A/B/C/D — não muda o comportamento de seleção, só o rótulo na UI.';
