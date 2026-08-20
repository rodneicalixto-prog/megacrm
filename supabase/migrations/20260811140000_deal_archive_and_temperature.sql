-- ============================================================================
-- Funil: arquivar negócios + temperatura automática por resultado
-- ----------------------------------------------------------------------------
-- 1. deals.archived_at — soft-archive do card no Kanban. Segue o mesmo padrão
--    de outras flags do hub (ex.: is_active em follow_up_rules/ai_agent_config):
--    coluna simples, sem policy de RLS dedicada — a SELECT de `deals` já é
--    aberta a authenticated (USING (true), ver 20260630120000_crm_layer.sql),
--    então o filtro "esconder arquivados por padrão" fica no client (usePipeline
--    / FunilFilter), igual ao resto dos filtros do board hoje.
-- 2. Trigger: ao marcar o negócio como ganho, `temperature` vira 'Morno'; ao
--    marcar como perdido, vira 'Frio'. Roda no banco (BEFORE UPDATE OF status,
--    mesmo gatilho que já normaliza won_at/lost_at em _sync_deal_outcome_ts —
--    ver 20260713140000_sales_dashboard.sql) para valer em qualquer caminho que
--    mude o status (drawer, automação futura, etc.), não só no clique da UI.
--    Não existe hoje uma flag de "temperatura escolhida manualmente" em deals,
--    então o trigger sempre sobrescreve no momento da transição — é o
--    comportamento mais simples e é o que o pedido original descreve. Se no
--    futuro precisar respeitar uma escolha manual, adicionar uma coluna
--    booleana (ex. temperature_locked) e checá-la aqui, no mesmo espírito do
--    `contacts.kind IS NULL` em _deal_won_to_sales.
-- ============================================================================

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Arquivar deals
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.deals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Board só busca "ativos" na maior parte do tempo; índice parcial cobre o caso
-- comum (arquivados são exceção, não vale indexar os dois lados).
CREATE INDEX IF NOT EXISTS idx_deals_active ON whatsapp_hub.deals(pipeline_id) WHERE archived_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Temperatura automática por resultado (won → Morno, lost → Frio)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub._deal_status_temperature()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  -- Só reage a uma TRANSIÇÃO de status (evita reescrever a cada UPDATE que
  -- toca outra coluna e reconfirma o mesmo status).
  IF NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' THEN
    NEW.temperature := 'Morno';
  ELSIF NEW.status = 'lost' AND OLD.status IS DISTINCT FROM 'lost' THEN
    NEW.temperature := 'Frio';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_status_temperature ON whatsapp_hub.deals;
CREATE TRIGGER trg_deal_status_temperature
  BEFORE UPDATE OF status ON whatsapp_hub.deals
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._deal_status_temperature();
