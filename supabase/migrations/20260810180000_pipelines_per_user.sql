-- Funil por usuario. Ate aqui pipelines era global: todo mundo via e mexia nos
-- mesmos funis, entao "meu funil" nao existia — renomear um estagio mudava a
-- tela de todo mundo.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- owner_id nulo = funil da empresa, visivel para todos e editavel so por admin.
-- Preenchido = funil pessoal, so do dono. Os funis que ja existem viram da
-- empresa, que e o que eles de fato eram.
ALTER TABLE whatsapp_hub.pipelines
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS pipelines_owner_idx ON whatsapp_hub.pipelines (owner_id);

DROP POLICY IF EXISTS pipelines_select ON whatsapp_hub.pipelines;
CREATE POLICY pipelines_select ON whatsapp_hub.pipelines
  FOR SELECT TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());

DROP POLICY IF EXISTS pipelines_write ON whatsapp_hub.pipelines;
-- Sem limite de quantidade: criar funil e barato e a restricao so empurraria a
-- pessoa a reaproveitar um funil errado.
DROP POLICY IF EXISTS pipelines_insert ON whatsapp_hub.pipelines;
CREATE POLICY pipelines_insert ON whatsapp_hub.pipelines
  FOR INSERT TO authenticated
  WITH CHECK (
    (owner_id = auth.uid() AND whatsapp_hub.can_operate())
    OR (owner_id IS NULL AND whatsapp_hub.is_admin())
  );

DROP POLICY IF EXISTS pipelines_update ON whatsapp_hub.pipelines;
CREATE POLICY pipelines_update ON whatsapp_hub.pipelines
  FOR UPDATE TO authenticated
  USING ((owner_id = auth.uid()) OR (owner_id IS NULL AND whatsapp_hub.is_admin()))
  WITH CHECK ((owner_id = auth.uid()) OR (owner_id IS NULL AND whatsapp_hub.is_admin()));

DROP POLICY IF EXISTS pipelines_delete ON whatsapp_hub.pipelines;
CREATE POLICY pipelines_delete ON whatsapp_hub.pipelines
  FOR DELETE TO authenticated
  USING ((owner_id = auth.uid()) OR (owner_id IS NULL AND whatsapp_hub.is_admin()));

-- Estagios seguem o funil: quem enxerga o funil enxerga os estagios, quem edita
-- o funil edita os estagios. Deixar stages com policy propria era como uma
-- pessoa acabava editando o estagio de um funil que nem via.
DROP POLICY IF EXISTS stages_select ON whatsapp_hub.stages;
CREATE POLICY stages_select ON whatsapp_hub.stages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM whatsapp_hub.pipelines p
     WHERE p.id = stages.pipeline_id
       AND (p.owner_id IS NULL OR p.owner_id = auth.uid())
  ));

DROP POLICY IF EXISTS stages_write ON whatsapp_hub.stages;
CREATE POLICY stages_write ON whatsapp_hub.stages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM whatsapp_hub.pipelines p
     WHERE p.id = stages.pipeline_id
       AND ((p.owner_id = auth.uid()) OR (p.owner_id IS NULL AND whatsapp_hub.is_admin()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM whatsapp_hub.pipelines p
     WHERE p.id = stages.pipeline_id
       AND ((p.owner_id = auth.uid()) OR (p.owner_id IS NULL AND whatsapp_hub.is_admin()))
  ));
