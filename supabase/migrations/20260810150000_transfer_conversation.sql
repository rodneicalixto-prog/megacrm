-- Transferencia de conversa: entre pessoas e entre departamentos.
CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

-- Fica numa funcao, e nao em dois updates no cliente, porque a transferencia
-- tem que ser atomica com o registro dela: uma conversa que muda de dono sem
-- deixar rastro na thread chega no destinatario sem contexto nenhum, e ele
-- responde sem saber o que ja foi dito nem por que caiu com ele.
--
-- connection_id NAO muda. O contato escreveu para um numero especifico e a
-- resposta continua saindo por ele: transferir de setor muda quem atende, nao
-- por onde o cliente falou.
CREATE OR REPLACE FUNCTION whatsapp_hub.transfer_conversation(
  p_conversation_id uuid,
  p_to_user_id uuid DEFAULT NULL,
  p_to_department_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = whatsapp_hub, public
AS $$
declare
  v_conv       record;
  v_from_dept  text;
  v_to_dept    text;
  v_from_user  text;
  v_to_user    text;
  v_dept       uuid;
  v_clash      uuid;
  v_texto      text;
begin
  if p_to_user_id is null and p_to_department_id is null then
    raise exception 'Informe um destino: pessoa ou departamento.';
  end if;

  select c.id, c.department_id, c.assigned_to
    into v_conv
    from whatsapp_hub.conversations c
   where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversa nao encontrada.';
  end if;

  -- Destino por pessoa: o departamento vai junto, senao a conversa ficaria com
  -- um dono que as policies do proprio departamento dele nao deixam enxergar.
  v_dept := coalesce(
    p_to_department_id,
    (select au.department_id from whatsapp_hub.app_users au where au.user_id = p_to_user_id),
    v_conv.department_id
  );

  -- UNIQUE (contact_id, department_id) existe para separar o mesmo cliente
  -- falando com dois setores. Mover para um setor onde ele ja tem conversa
  -- violaria a constraint com um erro cru; melhor recusar explicando.
  if v_dept is distinct from v_conv.department_id then
    select c2.id into v_clash
      from whatsapp_hub.conversations c2
      join whatsapp_hub.conversations c1 on c1.id = p_conversation_id
     where c2.contact_id = c1.contact_id
       and c2.department_id = v_dept
       and c2.id <> p_conversation_id
     limit 1;
    if v_clash is not null then
      raise exception 'Este contato ja tem uma conversa aberta nesse departamento.';
    end if;
  end if;

  select d.name into v_from_dept from whatsapp_hub.departments d where d.id = v_conv.department_id;
  select d.name into v_to_dept   from whatsapp_hub.departments d where d.id = v_dept;
  select u.email into v_from_user from auth.users u where u.id = v_conv.assigned_to;
  select u.email into v_to_user   from auth.users u where u.id = p_to_user_id;

  update whatsapp_hub.conversations
     set department_id = v_dept,
         -- Destino sem pessoa = volta para a fila do setor, de proposito.
         assigned_to   = p_to_user_id,
         assigned_at   = case when p_to_user_id is null then null else now() end,
         -- Quem transfere esta entregando para um humano: a IA nao reassume.
         ai_paused     = true,
         status        = case when status = 'closed' then 'human_active' else status end,
         updated_at    = now()
   where id = p_conversation_id;

  v_texto := 'Transferida de ' || coalesce(v_from_dept, 'sem setor')
          || coalesce(' / ' || v_from_user, ' / fila')
          || ' para ' || coalesce(v_to_dept, 'sem setor')
          || coalesce(' / ' || v_to_user, ' / fila')
          || case when coalesce(trim(p_reason), '') = '' then '' else ' - ' || trim(p_reason) end;

  -- Nota privada: e registro interno, nunca sai para o contato.
  insert into whatsapp_hub.messages (
    conversation_id, direction, sender_type, sender_id,
    content_type, content, is_private_note
  ) values (
    p_conversation_id, 'outbound', 'system', auth.uid(),
    'note', v_texto, true
  );

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'department_id', v_dept,
    'assigned_to', p_to_user_id,
    'log', v_texto
  );
end;
$$;

GRANT EXECUTE ON FUNCTION whatsapp_hub.transfer_conversation(uuid, uuid, uuid, text) TO authenticated;
