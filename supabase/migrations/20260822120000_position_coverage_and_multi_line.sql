-- Duas lacunas reais na Evolution multi-numero, levantadas pelo usuario em
-- producao (nao havia design nem no PLANEJAMENTO.md nem no PLANO-HIERARQUIA):
--
-- 1. Um usuario so podia ocupar UM cargo (department_positions.user_id era
--    UNIQUE) -> no maximo uma linha pessoal por pessoa. Ha gente que atende
--    por 2 numeros (ex.: linha propria + linha de um produto especifico).
--    Vira "ate 2", nao ilimitado: troca a UNIQUE por um trigger que conta.
--
-- 2. Nao existia NENHUM jeito de outro operador assumir temporariamente a
--    linha pessoal de um colega ausente sem perder a propria. O numero de
--    fila (position_id NULL) ja tem round-robin; o numero pessoal
--    (position_id preenchido) sempre roteava pro dono do cargo, sempre —
--    ferias, folga ou desligamento nao mudavam nada.
--
-- Solucao: tabela de cobertura por cargo. Enquanto houver uma cobertura ATIVA
-- (ended_at IS NULL) para o cargo, mensagens NOVAS na linha pessoal vao pro
-- cobridor, nao pro titular — sem tocar no vinculo cargo->titular, que
-- continua intacto e volta a valer assim que a cobertura acaba. Conversas que
-- ja existiam antes da cobertura comecar continuam atribuidas a quem estava
-- atribuido (o RLS por departamento ja deixa qualquer colega do mesmo setor
-- ver e responder por elas hoje — a cobertura so decide o roteamento de
-- mensagens NOVAS).
--
-- `ends_at` e opcional (previsao de volta); um cron encerra sozinho quando
-- vence. Sem `ends_at`, so encerra manualmente — cobre o caso "nao sei quando
-- volta".

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Ate 2 cargos por usuario
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.department_positions
  DROP CONSTRAINT IF EXISTS department_positions_user_id_key;

CREATE OR REPLACE FUNCTION whatsapp_hub._enforce_max_positions_per_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = whatsapp_hub, public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    IF (
      SELECT count(*) FROM whatsapp_hub.department_positions
       WHERE user_id = NEW.user_id AND id <> NEW.id
    ) >= 2 THEN
      RAISE EXCEPTION 'Este usuário já está vinculado a 2 cargos — o máximo permitido.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_max_positions_per_user ON whatsapp_hub.department_positions;
CREATE TRIGGER trg_max_positions_per_user
  BEFORE INSERT OR UPDATE OF user_id ON whatsapp_hub.department_positions
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._enforce_max_positions_per_user();

-- ----------------------------------------------------------------------------
-- 2. Cobertura de cargo (linha pessoal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.position_coverage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id      UUID NOT NULL REFERENCES whatsapp_hub.department_positions(id) ON DELETE CASCADE,
  covering_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason           TEXT,
  -- Previsao de volta, so informativa/gatilho do cron. NULL = sem previsao,
  -- so encerra na mao.
  ends_at          TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = cobertura ativa. E o que o roteamento consulta.
  ended_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_position_coverage_position ON whatsapp_hub.position_coverage(position_id);

-- No maximo uma cobertura ativa por cargo — a segunda so pode nascer depois
-- de encerrar a primeira, senao "quem esta cobrindo" vira ambiguo.
CREATE UNIQUE INDEX IF NOT EXISTS position_coverage_active_key
  ON whatsapp_hub.position_coverage(position_id) WHERE ended_at IS NULL;

ALTER TABLE whatsapp_hub.position_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS position_coverage_select ON whatsapp_hub.position_coverage;
CREATE POLICY position_coverage_select ON whatsapp_hub.position_coverage
  FOR SELECT TO authenticated USING (true);

-- Mesmo alcance de quem hoje administra cargos/linhas (admin/super_admin),
-- mais o supervisor do PROPRIO setor — e quem primeiro sabe que alguem do
-- time faltou.
DROP POLICY IF EXISTS position_coverage_write ON whatsapp_hub.position_coverage;
CREATE POLICY position_coverage_write ON whatsapp_hub.position_coverage
  FOR ALL TO authenticated
  USING (
    whatsapp_hub.current_user_role() IN ('super_admin', 'admin')
    OR (
      whatsapp_hub.current_user_role() = 'supervisor'
      AND EXISTS (
        SELECT 1 FROM whatsapp_hub.department_positions p
         WHERE p.id = position_coverage.position_id
           AND p.department_id = whatsapp_hub.current_user_department()
      )
    )
  )
  WITH CHECK (
    whatsapp_hub.current_user_role() IN ('super_admin', 'admin')
    OR (
      whatsapp_hub.current_user_role() = 'supervisor'
      AND EXISTS (
        SELECT 1 FROM whatsapp_hub.department_positions p
         WHERE p.id = position_coverage.position_id
           AND p.department_id = whatsapp_hub.current_user_department()
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Encerramento automatico quando a previsao de volta vence
-- ----------------------------------------------------------------------------
-- SQL puro via pg_cron — sem Edge Function, mesmo padrao que outros jobs de
-- manutencao leve neste projeto.
DO $$
BEGIN
  PERFORM cron.unschedule('wh-expire-position-coverage');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'wh-expire-position-coverage',
  '*/15 * * * *',
  $$UPDATE whatsapp_hub.position_coverage
       SET ended_at = now()
     WHERE ended_at IS NULL
       AND ends_at IS NOT NULL
       AND ends_at <= now()$$
);
