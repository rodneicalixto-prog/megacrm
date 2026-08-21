-- Companion da migration anterior (kind 'atendimento'): antes de deixar o
-- usuário criar funis de atendimento de verdade, precisa garantir que um
-- negócio "ganho"/"resolvido" num funil de atendimento não vira venda.
--
-- _deal_won_to_sales / _deal_unwon_cleanup / import_won_deals_to_sales nunca
-- filtraram por pipelines.kind — qualquer deal que chegasse a um estágio
-- is_won virava linha em sales_records + repurchase_predictions (Vendas &
-- Recompra), não importa de qual funil. Isso não dava problema até agora
-- porque 'projeto'/'educacao' (os outros kinds do enum) nunca foram usados
-- por nenhuma UI — mas 'atendimento' vai ser usado de verdade a partir desta
-- rodada, e marcar um atendimento como "Resolvido" (equivalente a is_won,
-- pra reaproveitar o mesmo campo de estágio) não pode gerar uma "venda"
-- fantasma pro cliente entrar na lista de recompra.
--
-- Guard: as três só agem quando o pipeline do negócio é kind='comercial'.

SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub._deal_won_to_sales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_doc  TEXT;
  v_name TEXT;
  v_phone TEXT;
  v_date DATE := COALESCE(NEW.won_at::date, now()::date);
  DEFAULT_CYCLE_DAYS CONSTANT INT := 30;
BEGIN
  IF NEW.status <> 'won' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'won' THEN RETURN NEW; END IF; -- já processado

  -- Só funil comercial vira venda — funil de atendimento (ou os kinds
  -- vestigiais projeto/educacao) não têm relação com receita.
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_hub.pipelines p WHERE p.id = NEW.pipeline_id AND p.kind = 'comercial'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(c.custom_fields ->> 'cnpj'), ''),
                  NULLIF(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), ''),
                  c.id::text),
         c.name, c.phone
  INTO v_doc, v_name, v_phone
  FROM whatsapp_hub.contacts c WHERE c.id = NEW.contact_id;

  -- Base de vendas: um registro por produto do negócio; sem produtos → título.
  INSERT INTO whatsapp_hub.sales_records
    (customer_name, customer_doc, customer_phone, product_name, quantity, amount, purchase_date, source_file)
  SELECT v_name, v_doc, v_phone, p.name, 1, NEW.value, v_date, 'crm:negocio_ganho'
  FROM whatsapp_hub.deal_products dp
  JOIN whatsapp_hub.products p ON p.id = dp.product_id
  WHERE dp.deal_id = NEW.id
  ON CONFLICT (customer_doc, product_name, purchase_date) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM whatsapp_hub.deal_products dp WHERE dp.deal_id = NEW.id) THEN
    INSERT INTO whatsapp_hub.sales_records
      (customer_name, customer_doc, customer_phone, product_name, quantity, amount, purchase_date, source_file)
    VALUES (v_name, v_doc, v_phone, NEW.title, 1, NEW.value, v_date, 'crm:negocio_ganho')
    ON CONFLICT (customer_doc, product_name, purchase_date) DO NOTHING;
  END IF;

  -- Predição de recompra: o cliente ganho entra na LISTA com ciclo padrão.
  -- Linha já existente (calculada pelo compute) mantém o ciclo real; só a
  -- última compra/próxima prevista avançam quando a venda é mais recente.
  INSERT INTO whatsapp_hub.repurchase_predictions
    (customer_doc, customer_phone, customer_name, product_name, avg_interval_days,
     purchase_count, last_purchase, predicted_next, status, updated_at)
  SELECT v_doc, COALESCE(v_phone, ''), v_name, p.name, DEFAULT_CYCLE_DAYS,
         1, v_date, v_date + DEFAULT_CYCLE_DAYS, 'pending', now()
  FROM whatsapp_hub.deal_products dp
  JOIN whatsapp_hub.products p ON p.id = dp.product_id
  WHERE dp.deal_id = NEW.id
  ON CONFLICT (customer_doc, product_name) DO UPDATE SET
    customer_phone = COALESCE(NULLIF(EXCLUDED.customer_phone, ''), whatsapp_hub.repurchase_predictions.customer_phone),
    customer_name  = COALESCE(EXCLUDED.customer_name, whatsapp_hub.repurchase_predictions.customer_name),
    last_purchase  = GREATEST(EXCLUDED.last_purchase, whatsapp_hub.repurchase_predictions.last_purchase),
    predicted_next = GREATEST(EXCLUDED.last_purchase, whatsapp_hub.repurchase_predictions.last_purchase)
                     + whatsapp_hub.repurchase_predictions.avg_interval_days,
    status = CASE WHEN EXCLUDED.last_purchase > whatsapp_hub.repurchase_predictions.last_purchase
                  THEN 'pending' ELSE whatsapp_hub.repurchase_predictions.status END,
    updated_at = now();

  IF NOT EXISTS (SELECT 1 FROM whatsapp_hub.deal_products dp WHERE dp.deal_id = NEW.id) THEN
    INSERT INTO whatsapp_hub.repurchase_predictions
      (customer_doc, customer_phone, customer_name, product_name, avg_interval_days,
       purchase_count, last_purchase, predicted_next, status, updated_at)
    VALUES (v_doc, COALESCE(v_phone, ''), v_name, NEW.title, DEFAULT_CYCLE_DAYS,
            1, v_date, v_date + DEFAULT_CYCLE_DAYS, 'pending', now())
    ON CONFLICT (customer_doc, product_name) DO UPDATE SET
      customer_phone = COALESCE(NULLIF(EXCLUDED.customer_phone, ''), whatsapp_hub.repurchase_predictions.customer_phone),
      customer_name  = COALESCE(EXCLUDED.customer_name, whatsapp_hub.repurchase_predictions.customer_name),
      last_purchase  = GREATEST(EXCLUDED.last_purchase, whatsapp_hub.repurchase_predictions.last_purchase),
      predicted_next = GREATEST(EXCLUDED.last_purchase, whatsapp_hub.repurchase_predictions.last_purchase)
                       + whatsapp_hub.repurchase_predictions.avg_interval_days,
      status = CASE WHEN EXCLUDED.last_purchase > whatsapp_hub.repurchase_predictions.last_purchase
                    THEN 'pending' ELSE whatsapp_hub.repurchase_predictions.status END,
      updated_at = now();
  END IF;

  -- Quem compra é cliente (não sobrescreve escolha manual).
  UPDATE whatsapp_hub.contacts SET kind = 'cliente'
  WHERE id = NEW.contact_id AND kind IS NULL;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub._deal_unwon_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
DECLARE
  v_doc  TEXT;
  v_date DATE := OLD.won_at::date;
BEGIN
  -- Só age quando um negócio ganho deixa de ser ganho.
  IF NOT (OLD.status = 'won' AND NEW.status IS DISTINCT FROM 'won') THEN
    RETURN NEW;
  END IF;

  -- Mesmo guard de _deal_won_to_sales: só funil comercial gerou venda, então
  -- só funil comercial precisa de limpeza ao sair de won.
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_hub.pipelines p WHERE p.id = OLD.pipeline_id AND p.kind = 'comercial'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(c.custom_fields ->> 'cnpj'), ''),
                  NULLIF(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), ''),
                  c.id::text)
    INTO v_doc
    FROM whatsapp_hub.contacts c WHERE c.id = OLD.contact_id;

  IF v_doc IS NULL OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Remove a venda CRM originada deste ganho, por produto do negócio.
  DELETE FROM whatsapp_hub.sales_records sr
  USING whatsapp_hub.deal_products dp
  JOIN whatsapp_hub.products p ON p.id = dp.product_id
  WHERE dp.deal_id      = OLD.id
    AND sr.source_file  = 'crm:negocio_ganho'
    AND sr.customer_doc = v_doc
    AND sr.product_name = p.name
    AND sr.purchase_date = v_date;

  -- Fallback: negócio sem produtos usou o título como product_name.
  DELETE FROM whatsapp_hub.sales_records sr
  WHERE sr.source_file  = 'crm:negocio_ganho'
    AND sr.customer_doc = v_doc
    AND sr.product_name = OLD.title
    AND sr.purchase_date = v_date
    AND NOT EXISTS (SELECT 1 FROM whatsapp_hub.deal_products dp WHERE dp.deal_id = OLD.id);

  -- Predições sem NENHUMA venda por trás (CRM ou upload) somem da lista.
  DELETE FROM whatsapp_hub.repurchase_predictions rp
  WHERE rp.customer_doc = v_doc
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_hub.sales_records sr
      WHERE sr.customer_doc = rp.customer_doc
        AND sr.product_name = rp.product_name
    );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION whatsapp_hub.import_won_deals_to_sales()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'public', 'pg_temp'
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF whatsapp_hub.current_user_role() IS NULL
     OR whatsapp_hub.current_user_role() NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Apenas admin/operator podem importar negócios ganhos.';
  END IF;

  WITH won AS (
    SELECT d.id, d.title, d.value, d.won_at::date AS won_date, d.contact_id,
           c.name AS contact_name, c.phone,
           COALESCE(
             NULLIF(btrim(c.custom_fields ->> 'cnpj'), ''),
             NULLIF(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), ''),
             d.contact_id::text
           ) AS doc
    FROM whatsapp_hub.deals d
    JOIN whatsapp_hub.contacts c ON c.id = d.contact_id
    JOIN whatsapp_hub.pipelines p ON p.id = d.pipeline_id AND p.kind = 'comercial'
    WHERE d.status = 'won' AND d.won_at IS NOT NULL
  ),
  rows_to_insert AS (
    -- Um registro por produto atrelado ao negócio…
    SELECT w.doc, w.contact_name, w.phone, p.name AS product_name,
           1 AS quantity, w.value AS amount, w.won_date
    FROM won w
    JOIN whatsapp_hub.deal_products dp ON dp.deal_id = w.id
    JOIN whatsapp_hub.products p ON p.id = dp.product_id
    UNION ALL
    -- …ou o título do negócio quando não há produtos.
    SELECT w.doc, w.contact_name, w.phone, w.title,
           1, w.value, w.won_date
    FROM won w
    WHERE NOT EXISTS (SELECT 1 FROM whatsapp_hub.deal_products dp WHERE dp.deal_id = w.id)
  ),
  ins AS (
    INSERT INTO whatsapp_hub.sales_records
      (customer_name, customer_doc, customer_phone, product_name, quantity, amount, purchase_date, source_file)
    SELECT r.contact_name, r.doc, r.phone, r.product_name, r.quantity, r.amount, r.won_date, 'crm:negocios_ganhos'
    FROM rows_to_insert r
    ON CONFLICT (customer_doc, product_name, purchase_date) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  -- Contatos desses negócios viram clientes (sem sobrescrever escolha manual).
  UPDATE whatsapp_hub.contacts c
  SET kind = 'cliente'
  WHERE c.kind IS NULL
    AND EXISTS (
      SELECT 1 FROM whatsapp_hub.deals d
      JOIN whatsapp_hub.pipelines p ON p.id = d.pipeline_id AND p.kind = 'comercial'
      WHERE d.contact_id = c.id AND d.status = 'won'
    );

  RETURN v_inserted;
END;
$$;
