-- Onda 2 do pacote de atualização (PLANEJAMENTO.md): aviso de contato
-- duplicado. `contacts.phone` já é UNIQUE (dedup exata), mas o mesmo lead
-- pode chegar por dois canais com telefone normalizado diferente (DDI/9º
-- dígito) ou nome muito parecido — isso não é bloqueado, só sinalizado: quem
-- opera decide mesclar ou ignorar (ver ContactPanel).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

ALTER TABLE whatsapp_hub.contacts
  ADD COLUMN IF NOT EXISTS possible_duplicate_of UUID REFERENCES whatsapp_hub.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON whatsapp_hub.contacts USING GIN (name public.gin_trgm_ops);

-- Roda em todo INSERT, qualquer que seja o ponto de entrada (ingest-lead,
-- whatsapp-inbound, import de CSV, cadastro manual) — sem precisar
-- instrumentar cada Edge Function separadamente. Match por telefone compara
-- só os últimos 8 dígitos (sobrevive a diferença de DDI/9º dígito); match por
-- nome exige similaridade alta (0.5) para não gerar falso positivo com nomes
-- comuns curtos.
CREATE OR REPLACE FUNCTION whatsapp_hub._flag_possible_duplicate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  match_id uuid;
  new_phone_digits text := regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g');
BEGIN
  SELECT c.id INTO match_id
    FROM whatsapp_hub.contacts c
   WHERE c.id <> NEW.id
     AND (
       (length(new_phone_digits) >= 8
        AND right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = right(new_phone_digits, 8))
       OR (
         NEW.name IS NOT NULL AND trim(NEW.name) <> ''
         AND c.name IS NOT NULL
         AND public.similarity(c.name, NEW.name) > 0.5
       )
     )
   ORDER BY c.created_at ASC
   LIMIT 1;

  NEW.possible_duplicate_of := match_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_flag_duplicate ON whatsapp_hub.contacts;
CREATE TRIGGER trg_contacts_flag_duplicate
  BEFORE INSERT ON whatsapp_hub.contacts
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub._flag_possible_duplicate();
