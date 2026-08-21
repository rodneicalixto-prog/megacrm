-- Achado do advisor de segurança do Supabase (21/08/2026, rodada de
-- verificação pós-deploy): 5 funções SECURITY DEFINER em whatsapp_hub nunca
-- tiveram REVOKE de anon — diferente do padrão usado em toda função nova
-- desta rodada (module_enabled, _assert_module, create_user, etc., que
-- sempre fazem `REVOKE ... FROM PUBLIC, anon`). Sem o REVOKE explícito,
-- PostgreSQL concede EXECUTE a PUBLIC por padrão na criação da função —
-- e PUBLIC inclui anon, ou seja, qualquer requisição não autenticada
-- (anon key, que é pública/embarcada no build do frontend) conseguia
-- chamar essas RPCs diretamente via PostgREST.
--
-- Impacto real por função:
--   - list_operators(): vazava e-mail + role + setor de TODA a equipe pra
--     qualquer request não autenticada. O mais sério dos cinco.
--   - bump_campaign_counter / claim_campaign_contacts / increment_unread_count:
--     só são chamadas pelas Edge Functions (service role — grep confirma,
--     zero uso no frontend). anon conseguia corromper contadores de
--     campanha, "roubar" a fila de disparo de qualquer campanha (DoS no
--     dispatch-campaign), ou inflar unread_count de conversas arbitrárias.
--   - import_won_deals_to_sales(): tem checagem de papel interna
--     (`current_user_role() NOT IN ('admin','operator')`), mas pra um
--     chamador anon `current_user_role()` retorna NULL — e em PL/pgSQL
--     `IF NULL THEN` é tratado como falso, então a exceção nunca disparava
--     e o anon conseguia rodar a função inteira. Revoga o EXECUTE de anon
--     E corrige a checagem pra tratar NULL como não autorizado
--     explicitamente, não só como efeito colateral do REVOKE.

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.list_operators() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.list_operators() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.bump_campaign_counter(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.bump_campaign_counter(uuid, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.claim_campaign_contacts(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.claim_campaign_contacts(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.increment_unread_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.increment_unread_count(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION whatsapp_hub.import_won_deals_to_sales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_hub.import_won_deals_to_sales() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp_hub.import_won_deals_to_sales()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'public', 'pg_temp'
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  -- NULL tratado explicitamente como não autorizado — antes,
  -- current_user_role() NULL (chamador anon) fazia o IF nunca disparar
  -- (PL/pgSQL trata IF NULL como falso), então a checagem era pulada.
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
    AND EXISTS (SELECT 1 FROM whatsapp_hub.deals d WHERE d.contact_id = c.id AND d.status = 'won');

  RETURN v_inserted;
END;
$$;
