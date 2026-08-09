-- Bucket das midias que o OPERADOR envia pela inbox.
--
-- Na rota oficial (Zernio) o arquivo sobe para /media/upload-direct e o Zernio
-- devolve a URL. A Evolution nao tem esse endpoint: o /message/sendMedia recebe
-- uma URL (ou base64) e busca o arquivo. Base64 obrigaria trafegar ~33MB num
-- corpo JSON e ainda deixaria a thread do CRM sem imagem para exibir — sem URL,
-- nao ha o que renderizar depois. Entao o arquivo passa a viver aqui, e a mesma
-- URL serve a Evolution e a inbox.
--
-- Separado do whatsapp-hub-agent-media de proposito: aquele e o catalogo de
-- midias do agente, gerenciado por admin e listado na UI. Este e anexo de
-- conversa, escrito por qualquer atendente e efemero.

SET search_path TO whatsapp_hub, public;

-- Publico porque a Evolution precisa baixar sem credencial. Mesmo teto de 25MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-hub-outbound-media', 'whatsapp-hub-outbound-media', true, 25 * 1024 * 1024)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS wh_outbound_media_read   ON storage.objects;
DROP POLICY IF EXISTS wh_outbound_media_insert ON storage.objects;
DROP POLICY IF EXISTS wh_outbound_media_delete ON storage.objects;

CREATE POLICY wh_outbound_media_read
  ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'whatsapp-hub-outbound-media');

-- Quem atende envia anexo: admin E operator (o catalogo do agente e admin-only,
-- este nao).
CREATE POLICY wh_outbound_media_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-hub-outbound-media'
    AND whatsapp_hub.current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY wh_outbound_media_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-hub-outbound-media'
    AND whatsapp_hub.current_user_role() = 'admin'
  );
