-- Fecha o gap encontrado em 14/09/2026: check-sla cria a notificacao
-- 'sla_breach' e so evita duplicar enquanto ela continuar nao lida, mas
-- nada marcava como lida quando o humano de fato respondia -- o sino
-- ficava com o aviso pendurado mesmo depois da conversa resolvida.
--
-- Fix: trigger em whatsapp_hub.messages -- toda mensagem outbound humana
-- (nao nota privada, sender_type <> 'ai') com meta_status = 'sent' marca
-- como lida qualquer sla_breach ainda nao lida daquela conversa. So
-- observa 'sent' de proposito (nao qualquer INSERT/UPDATE): review do PR
-- #70 (chatgpt-codex-connector, P1) apontou que send-operator-message/
-- index.ts insere a mensagem ANTES de confirmar o envio no provedor
-- (Evolution/Zernio) e so depois faz UPDATE de meta_status pra 'sent' ou
-- 'failed' -- resolver no INSERT otimista faria o alerta sumir mesmo
-- quando o envio falhasse e o cliente continuasse sem resposta. Por isso a
-- trigger cobre INSERT (caso whatsapp-inbound isFromMe, que ja insere com
-- meta_status='sent' porque o WhatsApp ja entregou antes do webhook) e
-- UPDATE OF meta_status (caso send-operator-message/-media/-template, que
-- so confirma depois). Reaproveita o mesmo pulso que ja soa em tempo real
-- via Realtime (evento UPDATE ja tratado no useNotifications.ts do
-- frontend, remove a linha da lista local).
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
     OR NEW.meta_status IS DISTINCT FROM 'sent'
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
  AFTER INSERT OR UPDATE OF meta_status ON whatsapp_hub.messages
  FOR EACH ROW
  WHEN (NEW.direction = 'outbound')
  EXECUTE FUNCTION whatsapp_hub._on_outbound_resolve_sla();

-- Backfill (apontado por review no PR #70, P2): a trigger acima so observa
-- eventos futuros -- conversas que ja tinham sido respondidas por humano
-- ANTES desta migration existir ficariam com o sla_breach preso pra
-- sempre, exigindo clique manual. Resolve o estoque existente de uma vez
-- so: qualquer sla_breach nao lida cuja conversa ja tenha uma mensagem
-- outbound humana CONFIRMADA (meta_status='sent') mais recente que a
-- propria notificacao vira lida.
-- Rodado em producao em 14/09/2026: 12 notificacoes presas resolvidas
-- (na epoca sem o filtro de meta_status -- reconfirmado depois que na
-- base atual todo outbound humano ja tem meta_status='sent', entao o
-- resultado nao muda).
UPDATE whatsapp_hub.notifications n
SET is_read = true
WHERE n.type = 'sla_breach'
  AND n.is_read = false
  AND EXISTS (
    SELECT 1 FROM whatsapp_hub.messages m
    WHERE m.conversation_id = n.conversation_id
      AND m.direction = 'outbound'
      AND COALESCE(m.is_private_note, false) = false
      AND m.sender_type <> 'ai'
      AND m.meta_status = 'sent'
      AND m.created_at > n.created_at
  );

NOTIFY pgrst, 'reload schema';
