-- Conexao por POSICAO, alem de por departamento.
--
-- Duas realidades convivem na mesma empresa:
--   · Departamento Pessoal — UM numero. Chega na fila, o supervisor distribui.
--   · Recursos Humanos     — cada pessoa tem SEU numero. Quem escreveu para o
--                            Fulano ja e conversa do Fulano; nao ha fila.
--
-- Por isso `department_connections` deixa de ter department_id como chave
-- primaria (que limitava a UMA conexao por departamento) e passa a ter id
-- proprio. O que continua unico e a `instance`: e ela que o webhook manda, e
-- duas conexoes com o mesmo nome tornariam o roteamento ambiguo.

SET search_path TO whatsapp_hub, public;

-- A tabela nasceu durante a configuracao operacional dos departamentos, mas
-- precisa existir no historico versionado para uma instalacao nova conseguir
-- aplicar a FK abaixo. Manter o CREATE aqui (antes da primeira referencia)
-- torna o bootstrap reproduzivel sem alterar ambientes onde ela ja existe.
CREATE TABLE IF NOT EXISTS whatsapp_hub.department_positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES whatsapp_hub.departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  user_id       UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);

ALTER TABLE whatsapp_hub.department_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS department_positions_select ON whatsapp_hub.department_positions;
CREATE POLICY department_positions_select ON whatsapp_hub.department_positions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS department_positions_write ON whatsapp_hub.department_positions;
CREATE POLICY department_positions_write ON whatsapp_hub.department_positions
  FOR ALL TO authenticated
  USING (whatsapp_hub.current_user_role() IN ('super_admin', 'admin'))
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin', 'admin'));

ALTER TABLE whatsapp_hub.department_connections
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Nulo = numero do departamento (chega na fila).
  -- Preenchido = numero da pessoa (ja nasce atribuida a ela).
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES whatsapp_hub.department_positions(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'department_connections_pkey'
       AND conrelid = 'whatsapp_hub.department_connections'::regclass
  ) THEN
    ALTER TABLE whatsapp_hub.department_connections DROP CONSTRAINT department_connections_pkey;
  END IF;
  ALTER TABLE whatsapp_hub.department_connections ADD PRIMARY KEY (id);
EXCEPTION WHEN invalid_table_definition THEN
  NULL; -- ja tem PK em id
END $$;

CREATE INDEX IF NOT EXISTS idx_department_connections_dept
  ON whatsapp_hub.department_connections(department_id);
CREATE INDEX IF NOT EXISTS idx_department_connections_position
  ON whatsapp_hub.department_connections(position_id);

-- Uma posicao tem no maximo um numero.
CREATE UNIQUE INDEX IF NOT EXISTS department_connections_position_key
  ON whatsapp_hub.department_connections(position_id) WHERE position_id IS NOT NULL;

-- E o departamento tem no maximo um numero "de fila".
CREATE UNIQUE INDEX IF NOT EXISTS department_connections_queue_key
  ON whatsapp_hub.department_connections(department_id) WHERE position_id IS NULL;
