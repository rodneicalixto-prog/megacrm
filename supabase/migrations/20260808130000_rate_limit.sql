-- Rate limit de janela fixa para endpoints publicos.
--
-- ingest-lead roda com --no-verify-jwt e CORS aberto (e chamado do browser da
-- landing do cliente), entao nao ha auth para gatear. Sem limite, um bot inunda
-- o CRM de leads falsos.
--
-- Janela fixa em vez de sliding window: uma linha por (bucket, janela), um
-- UPSERT atomico por request. Um atacante consegue no maximo 2x o limite na
-- virada da janela — aceitavel para o que isso protege, e custa uma tabela.

SET search_path TO whatsapp_hub;

CREATE TABLE IF NOT EXISTS whatsapp_hub.rate_limit_hits (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

ALTER TABLE whatsapp_hub.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- Sem policy: so a service role (que ignora RLS) toca nesta tabela.

-- Registra um hit e devolve TRUE se ainda esta dentro do limite.
-- SECURITY DEFINER porque a funcao e chamada pela Edge Function via RPC.
CREATE OR REPLACE FUNCTION whatsapp_hub.bump_rate_limit(
  p_bucket         text,
  p_window_seconds integer,
  p_limit          integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, pg_temp
AS $$
DECLARE
  v_window timestamptz;
  v_hits   integer;
BEGIN
  -- Inicio da janela atual: truncamento do epoch ao multiplo de p_window_seconds.
  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO whatsapp_hub.rate_limit_hits (bucket, window_start, hits)
       VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start)
    DO UPDATE SET hits = whatsapp_hub.rate_limit_hits.hits + 1
    RETURNING hits INTO v_hits;

  -- Limpeza oportunista: janelas antigas nao servem mais para nada. Barato
  -- porque so roda quando a janela vira (o primeiro hit dela).
  IF v_hits = 1 THEN
    DELETE FROM whatsapp_hub.rate_limit_hits
     WHERE window_start < v_window - make_interval(secs => p_window_seconds * 10);
  END IF;

  RETURN v_hits <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_hub.bump_rate_limit(text, integer, integer) FROM PUBLIC;
