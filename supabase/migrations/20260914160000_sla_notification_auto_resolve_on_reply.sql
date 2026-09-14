-- Fecha o gap encontrado em 14/09/2026: check-sla cria a notificacao
-- 'sla_breach' e so evita duplicar enquanto ela continuar nao lida, mas
-- nada marcava como lida quando o humano de fato respondia -- o sino
-- ficava com o aviso pendurado mesmo depois da conversa resolvida.
--
-- Fix: trigger em whatsapp_hub.messages -- toda mensagem outbound humana
-- (nao nota privada, sender_type <> 'ai') marca como lida qualquer
-- sla_breach ainda nao lida daquela conversa. Reaproveita o mesmo pulso
-- que ja soa em tempo real via Realtime (evento UPDATE ja tratado no
-- useNotifications.ts do frontend, remove a linha da lista local).
--
-- Aplicado direto em producao (lstbxeaasyysboavdati) em 14/09/2026 antes
-- deste commit -- ver padrao em 20260914120000_restore_admin_queue_visibility.

SET search_path TO whatsapp_hub, public;

CREATE OR REPLACE FUNCTION whatsapp_hub._on_outbound_resolve_sla()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = whatsapp_hub, public, pg_temp
AS $$
BEGIN
  IF NEW.direction <> 'outbound'
     OR COALESCE(NEW.is_private_note, false) = true
     OR NEW.sender_type = 'ai'
  THEN
    RETURN NEW;
  END IF;

  UPDATE whatsapp_hub.notifications
     SET is_read = true
   WHERE conversation_id = NEW.conversation_id
     AND type = 'sla_breach'
     AND is_read = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_outbound_resolve_sla ON whatsapp_hub.messages;
CREATE TRIGGER on_outbound_resolve_sla
  AFTER INSERT ON whatsapp_hub.messages
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._on_outbound_resolve_sla();

NOTIFY pgrst, 'reload schema';
