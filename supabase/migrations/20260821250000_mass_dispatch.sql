-- Canal de disparo em massa via Evolution (WhatsApp Web), pedido do usuário
-- inspirado no sosapp.sosbot.online: nome da campanha, lista de contatos
-- (tags ou arquivo importado), conexão (linha WhatsApp do operador), agenda-
-- mento, até 5 modelos de mensagem enviados em timing randômico (sem lógica
-- fixa, para reduzir risco de banimento), anexos, painel de status, e uma
-- aba de arquivos reaproveitáveis entre disparos.
--
-- Decisão confirmada com o usuário (21/08/2026):
--   1) Via Evolution (WhatsApp Web da conexão), não via Zernio/Meta oficial —
--      só assim faz sentido ter 5 variações de texto livre e timing próprio;
--      a API oficial exige template aprovado e já é rate-limited pela Meta.
--      Isto está FORA dos termos de uso oficiais do WhatsApp Business — é o
--      mesmo risco de qualquer ferramenta de disparo via WhatsApp Web, o
--      timing randômico só reduz a chance de bloqueio, não elimina.
--   2) Mesmo padrão de módulo comercial que Campanhas/Vendas/Agente de IA:
--      dependendo do pacote, fica oculto (public.instance_plan).
--
-- Diferente de `campaigns` (Zernio/Meta, template aprovado, broadcast em
-- lote): este é um módulo paralelo, deliberadamente não reaproveita as
-- tabelas de campanha — misturar os dois fluxos (template aprovado vs texto
-- livre randomizado) no mesmo schema confundiria o que cada linha significa.
--
-- Modelo de envio: cron de 30s (`wh-dispatch-mass-messages`) processa UMA
-- linha pendente POR disparo POR tick (nunca rajada), e agenda o próximo
-- envio daquele disparo para `now() + random(min,max) segundos`. A cadência
-- mínima real é o próprio tick do cron (30s) — min_delay_seconds abaixo
-- disso não acelera nada, só documenta a intenção.
--
-- Sem ACK de entrega/leitura: a rota Evolution deste projeto não traz esse
-- webhook hoje (confirmado em whatsapp-inbound/index.ts, só grava
-- meta_status='sent'). O painel de qualidade usa o que É real: enviado,
-- falhou, e "respondeu" (heurística: inbound na conversa após o envio).

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. Tipos
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE whatsapp_hub.mass_dispatch_status AS ENUM
    ('draft', 'scheduled', 'sending', 'paused', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE whatsapp_hub.mass_dispatch_contact_status AS ENUM
    ('pending', 'sent', 'replied', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Arquivos reaproveitáveis (listas de contato + anexos de mensagem) —
--    "aba de gerenciamento de arquivos" pedida pelo usuário.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.mass_dispatch_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  file_type       TEXT NOT NULL CHECK (file_type IN ('contact_list', 'attachment')),
  storage_path    TEXT NOT NULL,
  media_type      TEXT,
  file_size_bytes BIGINT,
  -- Só para file_type='contact_list': contatos resolvidos no momento do
  -- upload (find-or-create por telefone), guardados prontos para reenvio
  -- instantâneo sem reparsear o CSV/XLSX.
  contact_ids     UUID[],
  uploaded_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Disparo (a "campanha" deste módulo)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_hub.mass_dispatches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  connection_id     UUID NOT NULL REFERENCES whatsapp_hub.department_connections(id) ON DELETE RESTRICT,
  status            whatsapp_hub.mass_dispatch_status NOT NULL DEFAULT 'draft',
  -- {mode:'tags', tag_ids:[...]} | {mode:'file', file_id:'...'} | {mode:'all'}
  audience_filter   JSONB NOT NULL DEFAULT '{}'::jsonb,
  min_delay_seconds INT NOT NULL DEFAULT 30 CHECK (min_delay_seconds >= 5),
  max_delay_seconds INT NOT NULL DEFAULT 90 CHECK (max_delay_seconds >= min_delay_seconds),
  scheduled_at      TIMESTAMPTZ,
  next_send_at      TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  total_contacts    INT NOT NULL DEFAULT 0,
  sent              INT NOT NULL DEFAULT 0,
  replied           INT NOT NULL DEFAULT 0,
  failed            INT NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mass_dispatches_status ON whatsapp_hub.mass_dispatches(status);

-- Até 5 modelos de mensagem por disparo, enviados em rodízio aleatório —
-- limite aplicado no app (RLS não expressa "no máximo N linhas" de forma
-- simples); a trigger abaixo é o cinto de segurança contra bypass do app.
CREATE TABLE IF NOT EXISTS whatsapp_hub.mass_dispatch_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id UUID NOT NULL REFERENCES whatsapp_hub.mass_dispatches(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  media_url   TEXT,
  media_type  TEXT,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mass_dispatch_messages_dispatch ON whatsapp_hub.mass_dispatch_messages(dispatch_id);

CREATE OR REPLACE FUNCTION whatsapp_hub._enforce_max_dispatch_messages()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM whatsapp_hub.mass_dispatch_messages WHERE dispatch_id = NEW.dispatch_id) >= 5 THEN
    RAISE EXCEPTION 'Máximo de 5 modelos de mensagem por disparo' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_max_dispatch_messages ON whatsapp_hub.mass_dispatch_messages;
CREATE TRIGGER trg_max_dispatch_messages
  BEFORE INSERT ON whatsapp_hub.mass_dispatch_messages
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._enforce_max_dispatch_messages();

-- Fila de envio: um contato por disparo.
CREATE TABLE IF NOT EXISTS whatsapp_hub.mass_dispatch_contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id           UUID NOT NULL REFERENCES whatsapp_hub.mass_dispatches(id) ON DELETE CASCADE,
  contact_id            UUID NOT NULL REFERENCES whatsapp_hub.contacts(id) ON DELETE CASCADE,
  status                whatsapp_hub.mass_dispatch_contact_status NOT NULL DEFAULT 'pending',
  message_id_used       UUID REFERENCES whatsapp_hub.mass_dispatch_messages(id) ON DELETE SET NULL,
  error_message         TEXT,
  evolution_message_id  TEXT,
  claimed_at            TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  replied_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dispatch_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_mass_dispatch_contacts_dispatch ON whatsapp_hub.mass_dispatch_contacts(dispatch_id, status);
CREATE INDEX IF NOT EXISTS idx_mass_dispatch_contacts_contact  ON whatsapp_hub.mass_dispatch_contacts(contact_id);

-- ----------------------------------------------------------------------------
-- 4. RLS — mesmo padrão do módulo comercial (module_enabled), mas write
--    aberto a qualquer papel operante (não só admin): o disparo em massa é
--    uma ferramenta do dia a dia do operador na sua própria linha, diferente
--    de Campanhas (que exige template aprovado pela Meta e é admin-only).
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.mass_dispatch_files    ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.mass_dispatches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.mass_dispatch_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_hub.mass_dispatch_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mass_dispatch_files_select ON whatsapp_hub.mass_dispatch_files;
CREATE POLICY mass_dispatch_files_select ON whatsapp_hub.mass_dispatch_files
  FOR SELECT TO authenticated
  USING (whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatch_files_write ON whatsapp_hub.mass_dispatch_files;
CREATE POLICY mass_dispatch_files_write ON whatsapp_hub.mass_dispatch_files
  FOR ALL TO authenticated
  USING (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'))
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatches_select ON whatsapp_hub.mass_dispatches;
CREATE POLICY mass_dispatches_select ON whatsapp_hub.mass_dispatches
  FOR SELECT TO authenticated
  USING (whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatches_write ON whatsapp_hub.mass_dispatches;
CREATE POLICY mass_dispatches_write ON whatsapp_hub.mass_dispatches
  FOR ALL TO authenticated
  USING (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'))
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatch_messages_select ON whatsapp_hub.mass_dispatch_messages;
CREATE POLICY mass_dispatch_messages_select ON whatsapp_hub.mass_dispatch_messages
  FOR SELECT TO authenticated
  USING (whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatch_messages_write ON whatsapp_hub.mass_dispatch_messages;
CREATE POLICY mass_dispatch_messages_write ON whatsapp_hub.mass_dispatch_messages
  FOR ALL TO authenticated
  USING (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'))
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatch_contacts_select ON whatsapp_hub.mass_dispatch_contacts;
CREATE POLICY mass_dispatch_contacts_select ON whatsapp_hub.mass_dispatch_contacts
  FOR SELECT TO authenticated
  USING (whatsapp_hub.module_enabled('disparo_massa'));

-- Só INSERT pelo frontend (materializa a fila ao criar o disparo); UPDATE/
-- DELETE de status ficam só com o service role (dispatcher) — impede que um
-- operador infle as próprias métricas de qualidade marcando linhas como
-- enviadas manualmente.
DROP POLICY IF EXISTS mass_dispatch_contacts_insert ON whatsapp_hub.mass_dispatch_contacts;
CREATE POLICY mass_dispatch_contacts_insert ON whatsapp_hub.mass_dispatch_contacts
  FOR INSERT TO authenticated
  WITH CHECK (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'));

DROP POLICY IF EXISTS mass_dispatch_contacts_delete ON whatsapp_hub.mass_dispatch_contacts;
CREATE POLICY mass_dispatch_contacts_delete ON whatsapp_hub.mass_dispatch_contacts
  FOR DELETE TO authenticated
  USING (whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator') AND whatsapp_hub.module_enabled('disparo_massa'));

-- ----------------------------------------------------------------------------
-- 5. RPCs (SECURITY DEFINER, chamadas pelo dispatch-mass-message via service
--    role — REVOKE de anon/authenticated segue o padrão corrigido nesta
--    sessão para as RPCs equivalentes de campanha).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub.claim_mass_dispatch_contact(
  p_dispatch_id uuid
) RETURNS SETOF whatsapp_hub.mass_dispatch_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub
AS $$
BEGIN
  RETURN QUERY
  UPDATE whatsapp_hub.mass_dispatch_contacts mc
     SET claimed_at = now()
   WHERE mc.id = (
     SELECT id
       FROM whatsapp_hub.mass_dispatch_contacts
      WHERE dispatch_id = p_dispatch_id
        AND status = 'pending'
        AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
   RETURNING mc.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION whatsapp_hub.claim_mass_dispatch_contact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.claim_mass_dispatch_contact(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp_hub.bump_mass_dispatch_counter(
  p_dispatch_id uuid,
  p_column      text,
  p_delta       int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub
AS $$
BEGIN
  IF p_column NOT IN ('sent', 'replied', 'failed') THEN
    RAISE EXCEPTION 'invalid counter column %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE whatsapp_hub.mass_dispatches SET %I = GREATEST(COALESCE(%I, 0) + $1, 0) WHERE id = $2',
    p_column, p_column
  ) USING p_delta, p_dispatch_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION whatsapp_hub.bump_mass_dispatch_counter(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_hub.bump_mass_dispatch_counter(uuid, text, int) TO service_role;

-- Heurística de resposta: uma mensagem inbound na conversa do contato depois
-- do envio conta como resposta ao disparo. Roda em toda mensagem inbound
-- (custo baixo: filtra por contact_id + status='sent', índice já cobre
-- ambos); não interfere em conversas fora de qualquer disparo (0 linhas
-- casadas = no-op).
CREATE OR REPLACE FUNCTION whatsapp_hub._mark_dispatch_replied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub
AS $$
DECLARE
  v_contact_id uuid;
  v_row RECORD;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT contact_id INTO v_contact_id FROM whatsapp_hub.conversations WHERE id = NEW.conversation_id;
  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_row IN
    SELECT id, dispatch_id FROM whatsapp_hub.mass_dispatch_contacts
     WHERE contact_id = v_contact_id AND status = 'sent' AND sent_at < NEW.created_at
  LOOP
    UPDATE whatsapp_hub.mass_dispatch_contacts
       SET status = 'replied', replied_at = NEW.created_at
     WHERE id = v_row.id;
    PERFORM whatsapp_hub.bump_mass_dispatch_counter(v_row.dispatch_id, 'replied', 1);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_dispatch_replied ON whatsapp_hub.messages;
CREATE TRIGGER trg_mark_dispatch_replied
  AFTER INSERT ON whatsapp_hub.messages
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._mark_dispatch_replied();

-- ----------------------------------------------------------------------------
-- 6. Storage bucket — arquivos reaproveitáveis (listas de contato + anexos).
--    Mesmo padrão de whatsapp-hub-outbound-media: público (URLs usadas
--    diretamente no envio Evolution), 25MB, RLS de escrita por papel.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-hub-dispatch-files', 'whatsapp-hub-dispatch-files', true, 25 * 1024 * 1024)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS mass_dispatch_files_public_read ON storage.objects;
CREATE POLICY mass_dispatch_files_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'whatsapp-hub-dispatch-files');

DROP POLICY IF EXISTS mass_dispatch_files_operator_write ON storage.objects;
CREATE POLICY mass_dispatch_files_operator_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-hub-dispatch-files'
    AND whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator')
  );

DROP POLICY IF EXISTS mass_dispatch_files_operator_delete ON storage.objects;
CREATE POLICY mass_dispatch_files_operator_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-hub-dispatch-files'
    AND whatsapp_hub.current_user_role() IN ('super_admin','admin','supervisor','operator')
  );

-- ----------------------------------------------------------------------------
-- 7. Módulo comercial: 4º módulo do pacote, mesmo mecanismo de
--    public.instance_plan. Decisão confirmada com o usuário: entra habilitado
--    por padrão nas instalações existentes (mesmo fail-open dos outros 3).
-- ----------------------------------------------------------------------------
UPDATE public.instance_plan
   SET enabled_modules = array_append(enabled_modules, 'disparo_massa')
 WHERE NOT ('disparo_massa' = ANY(enabled_modules));

ALTER TABLE public.instance_plan
  ALTER COLUMN enabled_modules SET DEFAULT ARRAY['campaigns','vendas','ai_agent','disparo_massa']::text[];

-- ----------------------------------------------------------------------------
-- 8. Cron — processa um disparo pendente por tick (30s), mesma cadência de
--    wh-dispatch-campaigns, reaproveitando o helper _cron_invoke_edge já
--    existente (Vault: whatsapp_hub_supabase_url / _service_role_key).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('wh-dispatch-mass-messages');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'wh-dispatch-mass-messages',
  '30 seconds',
  $cron$SELECT whatsapp_hub._cron_invoke_edge('dispatch-mass-message')$cron$
);
