-- Departamentos: multi-atendimento numa unica empresa.
--
-- Cada departamento tem seu proprio numero de WhatsApp, um supervisor e seus
-- atendentes. O numero que RECEBE a mensagem define o departamento — nao ha
-- triagem. Ver docs/PLANO-HIERARQUIA.md.
--
-- Esta migration cria a estrutura e faz o backfill. O ROTEAMENTO por numero
-- vem na proxima fase; ate la tudo continua saindo pela credencial global e
-- caindo no departamento padrao.

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Departamentos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.departments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  -- Destino de conversa que chegar sem departamento resolvido.
  is_default    BOOLEAN NOT NULL DEFAULT false,
  -- Departamento que o admin NAO le. Flag, e nao o nome no codigo: o dia que
  -- houver um segundo setor sigiloso (juridico, RH) a regra ja vale.
  is_restricted BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um so departamento padrao.
CREATE UNIQUE INDEX IF NOT EXISTS departments_single_default
  ON whatsapp_hub.departments ((is_default)) WHERE is_default;

-- ----------------------------------------------------------------------------
-- 2. Conexao de WhatsApp por departamento
-- ----------------------------------------------------------------------------
-- `instance` e o nome da instancia na Evolution: o webhook traz esse campo no
-- payload, e e por ele que a mensagem acha o departamento.
--
-- server_url e api_key_encrypted NULOS significam "usar a credencial global de
-- public.app_settings" — e o que mantem a instalacao atual funcionando enquanto
-- as conexoes por departamento nao forem preenchidas. SQL nao consegue semear
-- esses valores: eles estao cifrados e a CRYPTO_KEY vive na aplicacao.
CREATE TABLE IF NOT EXISTS whatsapp_hub.department_connections (
  department_id     UUID PRIMARY KEY REFERENCES whatsapp_hub.departments(id) ON DELETE CASCADE,
  instance          TEXT NOT NULL UNIQUE,
  server_url        TEXT,
  api_key_encrypted TEXT,
  phone_number      TEXT,
  connected_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Vinculos
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES whatsapp_hub.departments(id) ON DELETE SET NULL;

ALTER TABLE whatsapp_hub.conversations
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES whatsapp_hub.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_department ON whatsapp_hub.conversations(department_id);
CREATE INDEX IF NOT EXISTS idx_app_users_department     ON whatsapp_hub.app_users(department_id);

-- ----------------------------------------------------------------------------
-- 4. Semeia os dois departamentos base
-- ----------------------------------------------------------------------------
INSERT INTO whatsapp_hub.departments (name, description, is_default)
SELECT 'Geral', 'Departamento padrao — criado na migracao para departamentos.', true
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_hub.departments WHERE name = 'Geral');

INSERT INTO whatsapp_hub.departments (name, description, is_restricted)
SELECT 'Administracao Geral', 'Caixa do dono. O admin nao le as conversas daqui.', true
WHERE NOT EXISTS (SELECT 1 FROM whatsapp_hub.departments WHERE name = 'Administracao Geral');

-- ----------------------------------------------------------------------------
-- 5. Backfill
-- ----------------------------------------------------------------------------
-- Sem isto, no dia do deploy as policies novas nao casam com nada e o inbox
-- fica vazio. Idempotente: so preenche quem esta nulo.
UPDATE whatsapp_hub.conversations
   SET department_id = (SELECT id FROM whatsapp_hub.departments WHERE is_default LIMIT 1)
 WHERE department_id IS NULL;

UPDATE whatsapp_hub.app_users
   SET department_id = (SELECT id FROM whatsapp_hub.departments WHERE is_default LIMIT 1)
 WHERE department_id IS NULL;

-- Agora que toda linha tem valor, a coluna pode exigir um.
ALTER TABLE whatsapp_hub.conversations ALTER COLUMN department_id SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Uma conversa por contato POR DEPARTAMENTO
-- ----------------------------------------------------------------------------
-- A constraint antiga era UNIQUE (contact_id) na instalacao inteira. Com um
-- numero por departamento, o mesmo cliente falando com Vendas e depois com
-- Suporte quebraria o insert — ou pior, as duas conversas virariam uma so,
-- misturando departamentos e furando o recorte de visibilidade.
ALTER TABLE whatsapp_hub.conversations
  DROP CONSTRAINT IF EXISTS conversations_contact_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_contact_department_key'
  ) THEN
    ALTER TABLE whatsapp_hub.conversations
      ADD CONSTRAINT conversations_contact_department_key UNIQUE (contact_id, department_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.departments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.department_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select ON whatsapp_hub.departments;
DROP POLICY IF EXISTS departments_write  ON whatsapp_hub.departments;

-- Todo mundo precisa ler a lista: e ela que alimenta o seletor de transferencia.
CREATE POLICY departments_select ON whatsapp_hub.departments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY departments_write ON whatsapp_hub.departments
  FOR ALL TO authenticated
  USING      (whatsapp_hub.current_user_role() IN ('super_admin', 'admin'))
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin', 'admin'));

-- Conexoes guardam credencial cifrada: nenhuma policy: so a service role
-- (Edge Functions e API Routes) enxerga. O front consulta pela API.
