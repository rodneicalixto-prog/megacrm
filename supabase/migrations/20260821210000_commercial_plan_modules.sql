-- Decisão de produto (21/08/2026): Campanhas, Vendas & Recompra e Agente de
-- IA passam a ser módulos do pacote comercial — dependendo do que o cliente
-- contratou, eles ficam ocultos (sem o "pacote total" = sem esses 3 itens).
-- Perguntado ao usuário via AskUserQuestion e decidido:
--   1) Sem tela de edição nesta rodada — o pacote de cada instalação é
--      ajustado direto no Supabase do cliente (SQL/MCP) quando o pacote é
--      fechado ou muda, mesma dinâmica manual que a instalação já tem hoje
--      no /setup. Por isso o valor mora em public (junto da infra que só
--      service role acessa), não em whatsapp_hub — do contrário o próprio
--      super_admin da instalação poderia se autodesbloquear pela RLS normal.
--   2) Módulo Agente de IA desligado por pacote desliga de verdade: a IA
--      para de responder automaticamente no Inbox, não só a tela de
--      configuração fica inacessível.
--
-- Enforcement: RLS nas tabelas de escrita de cada módulo (Campanhas:
-- templates/campaigns; Vendas & Recompra: sales_records/repurchase_*;
-- Agente de IA: ai_agent_config) mais o check explícito em
-- process-ai-message (Edge Function usa service role, que bypassa RLS).
-- Não cobre jobs em andamento (ex.: uma campanha já disparando continua),
-- só bloqueia CRIAR/editar conteúdo novo do módulo — escopo aceito, igual ao
-- resto da autorização deste projeto (não é um servidor de licenciamento).
--
-- De brinde: as policies de escrita destes módulos comparavam
-- current_user_role() = 'admin' (literal), o mesmo bug de "super_admin
-- excluído" corrigido várias vezes nesta rodada — corrigidas pra
-- whatsapp_hub.is_admin() ao mesmo tempo que ganham o gate de módulo.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. public.instance_plan — singleton, mesmo padrão de public.app_settings /
--    public._bootstrap_state: RLS ligada, ZERO policies (só service role lê
--    ou escreve). enabled_modules com os 3 módulos por padrão (fail-open:
--    instalação existente sem linha configurada continua com tudo liberado).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instance_plan (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled_modules text[] NOT NULL DEFAULT ARRAY['campaigns', 'vendas', 'ai_agent']::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.instance_plan (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.instance_plan ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. Helpers — module_enabled() pra uso em policies RLS, _assert_module()
--    pra uso em funções que precisam interromper a execução (RPCs chamadas
--    direto pelo frontend, que bypassam RLS por serem SECURITY DEFINER).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub.module_enabled(p_module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT p_module = ANY(enabled_modules) FROM public.instance_plan WHERE id = true),
    true
  );
$$;
REVOKE EXECUTE ON FUNCTION whatsapp_hub.module_enabled(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.module_enabled(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp_hub._assert_module(p_module text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'pg_temp'
AS $$
BEGIN
  IF NOT whatsapp_hub.module_enabled(p_module) THEN
    RAISE EXCEPTION 'Módulo % não habilitado para esta instalação', p_module USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION whatsapp_hub._assert_module(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub._assert_module(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Campanhas: templates + campaigns.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS templates_admin_write ON whatsapp_hub.templates;
CREATE POLICY templates_admin_write ON whatsapp_hub.templates
  FOR ALL TO authenticated
  USING (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('campaigns'))
  WITH CHECK (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('campaigns'));

DROP POLICY IF EXISTS campaigns_admin_write ON whatsapp_hub.campaigns;
CREATE POLICY campaigns_admin_write ON whatsapp_hub.campaigns
  FOR ALL TO authenticated
  USING (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('campaigns'))
  WITH CHECK (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('campaigns'));

-- ----------------------------------------------------------------------------
-- 4. Vendas & Recompra: sales_records + repurchase_predictions/_config, mais
--    as duas RPCs SECURITY DEFINER que o frontend chama direto (bypassam RLS
--    das tabelas, por isso precisam do próprio guard).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS sales_records_write ON whatsapp_hub.sales_records;
CREATE POLICY sales_records_write ON whatsapp_hub.sales_records
  FOR ALL TO authenticated
  USING (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('vendas'))
  WITH CHECK (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('vendas'));

DROP POLICY IF EXISTS reconfig_write ON whatsapp_hub.repurchase_config;
CREATE POLICY reconfig_write ON whatsapp_hub.repurchase_config
  FOR ALL TO authenticated
  USING (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('vendas'))
  WITH CHECK (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('vendas'));

DROP POLICY IF EXISTS repredict_write ON whatsapp_hub.repurchase_predictions;
CREATE POLICY repredict_write ON whatsapp_hub.repurchase_predictions
  FOR ALL TO authenticated
  USING ((whatsapp_hub.is_admin() OR whatsapp_hub.current_user_role() = 'operator') AND whatsapp_hub.module_enabled('vendas'))
  WITH CHECK ((whatsapp_hub.is_admin() OR whatsapp_hub.current_user_role() = 'operator') AND whatsapp_hub.module_enabled('vendas'));

CREATE OR REPLACE FUNCTION whatsapp_hub.compute_repurchase_predictions()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = whatsapp_hub, pg_temp
AS $$
DECLARE
  v_min int;
  v_count int := 0;
BEGIN
  PERFORM whatsapp_hub._assert_module('vendas');

  SELECT min_purchases INTO v_min FROM whatsapp_hub.repurchase_config WHERE id = 1;
  v_min := COALESCE(v_min, 3);

  WITH agg AS (
    SELECT
      customer_doc, product_name,
      max(customer_phone) FILTER (WHERE customer_phone IS NOT NULL) AS customer_phone,
      max(customer_name)  FILTER (WHERE customer_name  IS NOT NULL) AS customer_name,
      count(DISTINCT purchase_date) AS purchase_count,
      min(purchase_date) AS first_purchase,
      max(purchase_date) AS last_purchase
    FROM whatsapp_hub.sales_records
    WHERE customer_doc IS NOT NULL
    GROUP BY customer_doc, product_name
    HAVING count(DISTINCT purchase_date) >= v_min
  ),
  calc AS (
    SELECT customer_doc, product_name, customer_phone, customer_name, purchase_count, last_purchase,
      GREATEST(1, round((last_purchase - first_purchase)::numeric / NULLIF(purchase_count - 1, 0)))::int AS avg_interval_days
    FROM agg
  ),
  upsert AS (
    INSERT INTO whatsapp_hub.repurchase_predictions
      (customer_doc, customer_phone, customer_name, product_name, avg_interval_days,
       purchase_count, last_purchase, predicted_next, status, updated_at)
    SELECT customer_doc, COALESCE(customer_phone, ''), customer_name, product_name,
      avg_interval_days, purchase_count, last_purchase, last_purchase + avg_interval_days, 'pending', now()
    FROM calc
    ON CONFLICT (customer_doc, product_name) DO UPDATE SET
      customer_phone = EXCLUDED.customer_phone,
      customer_name = EXCLUDED.customer_name,
      avg_interval_days = EXCLUDED.avg_interval_days,
      purchase_count = EXCLUDED.purchase_count,
      last_purchase = EXCLUDED.last_purchase,
      predicted_next = EXCLUDED.predicted_next,
      status = CASE WHEN EXCLUDED.last_purchase > whatsapp_hub.repurchase_predictions.last_purchase
                    THEN 'pending' ELSE whatsapp_hub.repurchase_predictions.status END,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upsert;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub.sales_dashboard(p_window_days int DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = whatsapp_hub, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM whatsapp_hub._assert_module('vendas');

  WITH base AS (SELECT * FROM whatsapp_hub.sales_records),
  active AS (
    SELECT DISTINCT customer_doc FROM base
    WHERE customer_doc IS NOT NULL AND purchase_date >= (current_date - make_interval(days => p_window_days))
  ),
  per_customer AS (
    SELECT customer_doc, count(DISTINCT product_name) AS produtos
    FROM base WHERE customer_doc IS NOT NULL GROUP BY customer_doc
  ),
  ranking AS (
    SELECT product_name, count(*) AS compras, sum(quantity) AS qtd
    FROM base GROUP BY product_name ORDER BY count(*) DESC LIMIT 5
  ),
  intervals AS (SELECT avg_interval_days FROM whatsapp_hub.repurchase_predictions)
  SELECT jsonb_build_object(
    'total_records', (SELECT count(*) FROM base),
    'active_customers', (SELECT count(*) FROM active),
    'avg_products_per_customer', COALESCE((SELECT round(avg(produtos), 1) FROM per_customer), 0),
    'avg_ticket', COALESCE((SELECT round(avg(amount), 2) FROM base WHERE amount IS NOT NULL), 0),
    'avg_repurchase_interval', COALESCE((SELECT round(avg(avg_interval_days)) FROM intervals), 0),
    'top_products', COALESCE((SELECT jsonb_agg(jsonb_build_object('product', product_name, 'compras', compras, 'qtd', qtd)) FROM ranking), '[]'::jsonb),
    'at_risk_count', (SELECT count(*) FROM whatsapp_hub.repurchase_predictions
                      WHERE status = 'pending'
                        AND predicted_next <= current_date + (SELECT lead_days FROM whatsapp_hub.repurchase_config WHERE id=1))
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Agente de IA: ai_agent_config (a checagem que desliga as respostas
--    automáticas de verdade mora em process-ai-message, fora do SQL).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS ai_agent_config_admin_all ON whatsapp_hub.ai_agent_config;
CREATE POLICY ai_agent_config_admin_all ON whatsapp_hub.ai_agent_config
  FOR ALL TO authenticated
  USING (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('ai_agent'))
  WITH CHECK (whatsapp_hub.is_admin() AND whatsapp_hub.module_enabled('ai_agent'));
