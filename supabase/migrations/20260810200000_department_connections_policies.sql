-- A tabela nasceu com RLS ligado e sem nenhuma policy, entao ninguem lia nada
-- pelo navegador: as Edge Functions usam service role e nao sentiram, mas o
-- filtro de "Numero" do inbox e a tela de Setores viriam sempre vazios.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.department_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS department_connections_select ON whatsapp_hub.department_connections;
CREATE POLICY department_connections_select ON whatsapp_hub.department_connections
  FOR SELECT TO authenticated
  USING (true);

-- Escrita e admin: uma linha apontada para o departamento errado desvia
-- conversa de cliente.
DROP POLICY IF EXISTS department_connections_write ON whatsapp_hub.department_connections;
CREATE POLICY department_connections_write ON whatsapp_hub.department_connections
  FOR ALL TO authenticated
  USING (whatsapp_hub.is_admin())
  WITH CHECK (whatsapp_hub.is_admin());

-- A chave da conexao e cifrada, mas nao tem por que trafegar para o browser.
REVOKE SELECT (api_key_encrypted) ON whatsapp_hub.department_connections FROM authenticated;
