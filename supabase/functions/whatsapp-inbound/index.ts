// ============================================================================
// whatsapp-inbound  (público, HMAC-verified para Zernio)  · Fase 4
// ----------------------------------------------------------------------------
// Fecha o loop de atribuição: mensagem inbound → origem no lead.
//   1. Roteia pelo provedor (?provider= ou detecção por X-Zernio-Signature).
//   2. Zernio: valida HMAC (X-Zernio-Signature) contra zernio_webhook_secret.
//   3. parseInboundWebhook do adapter (Fase 3). Ignora echo (isFromMe) e não-msg.
//   4. Idempotência por messageId em whatsapp_hub.webhook_events.
//   5. Resolve/cria o contato (por telefone).
//   6. extractReferral → chama a RPC attribute_inbound_lead, que aplica a
//      hierarquia CTWA > código de rastreio > whatsapp_direto.
//
// Deploy com --no-verify-jwt: provedores chamam anonimamente; o HMAC (Zernio) e
// a resolução de credenciais são os gates. A Evolution (Baileys) não assina.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  resolveInboundProvider,
  type ProviderName,
} from '../_shared/whatsapp/index.ts';
import { secretMatches, verifyWebhookSignature } from '../_shared/signature.ts';
import { connectionForInstance, instanceFromPayload, providerFor } from '../_shared/whatsapp/department-routing.ts';

// Nome distinto do normalizePhone de _shared/whatsapp/types.ts — o bundler do
// bootstrap inlina os _shared no mesmo escopo do módulo.
function toE164(raw: string): string {
  const t = raw.trim();
  return t.startsWith('+') ? t : `+${t}`;
}

const INBOUND_MEDIA_BUCKET = 'whatsapp-hub-outbound-media';

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'media.bin';
}

// Handler exportado para poder ser exercitado fora do runtime: o `Deno.serve`
// abaixo e so o registro. Sem essa separacao, importar o modulo num teste
// levantaria um servidor.
export async function handleInbound(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(req.url);
  const hasZernioSig = req.headers.get('X-Zernio-Signature') !== null;
  const hint = (url.searchParams.get('provider') as ProviderName | null)
    ?? (hasZernioSig ? 'zernio' : undefined);

  const rawBody = await req.text();

  // Zernio: HMAC obrigatório.
  if (hint === 'zernio' || hasZernioSig) {
    const secret = await getCredential('zernio_webhook_secret');
    const sig = req.headers.get('X-Zernio-Signature') ?? '';
    if (!secret) return jsonResponse({ ok: false, error: 'webhook secret ausente' }, { status: 500 });
    if (!(await verifyWebhookSignature(secret, rawBody, sig))) {
      return jsonResponse({ ok: false, error: 'assinatura inválida' }, { status: 401 });
    }
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const creds = {
    zernio_api_key: await getCredential('zernio_api_key'),
    evolution_server_url: await getCredential('evolution_server_url'),
    evolution_api_key: await getCredential('evolution_api_key'),
    evolution_instance: await getCredential('evolution_instance'),
  };
  const provider = resolveInboundProvider(hint, creds);
  if (!provider) {
    return jsonResponse({ ok: false, error: 'nenhum provedor configurado' }, { status: 500 });
  }

  if (provider.name === 'evolution') {
    const expected = await getCredential('evolution_webhook_secret');
    const received =
      req.headers.get('X-MegaCRM-Webhook-Secret') ??
      url.searchParams.get('token') ??
      '';
    if (!expected) {
      return jsonResponse({ ok: false, error: 'webhook Evolution sem segredo configurado' }, { status: 500 });
    }
    if (!secretMatches(received, expected)) {
      return jsonResponse({ ok: false, error: 'segredo de webhook inválido' }, { status: 401 });
    }
  }

  const admin = getAdminClient();

  // Reação (emoji) — não é mensagem: nunca criava contato/conversa, só
  // anotava (ou removia) a reação na mensagem alvo. Precisa ser interceptada
  // ANTES de parseInboundWebhook: esse não reconhece reactionMessage e
  // devolveria um "texto vazio", virando bolha em branco na conversa.
  if (provider.name === 'evolution' && provider.parseReaction) {
    const reaction = provider.parseReaction(payload);
    if (reaction) {
      const targetKey = `evolution:${reaction.targetMessageId}`;
      const { data: target } = await admin
        .from('messages')
        .select('id, reactions')
        .eq('zernio_message_id', targetKey)
        .maybeSingle();
      if (target) {
        const targetRow = target as { id: string; reactions: unknown };
        const current = Array.isArray(targetRow.reactions)
          ? targetRow.reactions as Array<Record<string, unknown>>
          : [];
        // Numa conversa 1:1 só há dois possíveis autores de reação: o
        // contato ou o próprio número conectado (o dono, reagindo pelo
        // celular em vez do CRM) — não há sessão de operador aqui.
        const source = reaction.fromMe ? 'owner_phone' : 'contact';
        const filtered = current.filter((r) => r.source !== source);
        const next = reaction.emoji
          ? [...filtered, { emoji: reaction.emoji, source, created_at: new Date().toISOString() }]
          : filtered; // texto vazio = Baileys removeu a reação
        await admin.from('messages').update({ reactions: next }).eq('id', targetRow.id);
      }
      return jsonResponse({ ok: true, reaction: true, matched: Boolean(target) });
    }
  }

  const inbound = provider.parseInboundWebhook(payload);
  if (!inbound) {
    return jsonResponse({ ok: true, skipped: 'não-inbound' });
  }

  // Qual número recebeu? É isso que define o departamento — não há triagem.
  // Fora da rota Evolution não há instância; cai no padrão.
  let departmentId: string | null = null;
  // Número de pessoa => a conversa já nasce com dono; número de fila => nulo, e
  // o supervisor distribui.
  let assignTo: string | null = null;
  let connectionId: string | null = null;
  let inboundMediaProvider = provider;
  if (provider.name === 'evolution') {
    const instance = instanceFromPayload(payload);
    const conn = instance ? await connectionForInstance(instance) : null;
    const usesConfiguredGlobalInstance =
      instance != null && instance === creds.evolution_instance;
    if (!conn && !usesConfiguredGlobalInstance) {
      console.log(JSON.stringify({ event: 'instance_sem_departamento', instance }));
      return jsonResponse(
        { ok: false, error: 'instância não associada a departamento' },
        { status: 500 },
      );
    }
    if (conn) {
      inboundMediaProvider = providerFor(conn);
      departmentId = conn.departmentId;
      assignTo = conn.assignToUserId ?? null;
      connectionId = conn.connectionId;
    } else {
      const { data: defaultDepartment } = await admin
        .from('departments')
        .select('id')
        .eq('is_default', true)
        .maybeSingle();
      departmentId = (defaultDepartment as { id: string } | null)?.id ?? null;
      if (!departmentId) {
        return jsonResponse(
          { ok: false, error: 'instância global sem departamento padrão' },
          { status: 500 },
        );
      }
      console.log(JSON.stringify({
        event: 'global_instance_default_department',
        instance,
        department_id: departmentId,
      }));
    }
    if (!assignTo) {
      const { data: queuedUser, error: queueError } = await getAdminClient().rpc(
        'next_department_assignee',
        { p_department_id: departmentId },
      );
      if (queueError) {
        console.log(JSON.stringify({
          event: 'department_assignment_failed',
          department_id: departmentId,
          message: queueError.message,
        }));
      } else {
        assignTo = typeof queuedUser === 'string' ? queuedUser : null;
      }
    }

  }

  // Baileys entrega uma URL para bytes criptografados, que o navegador não
  // consegue tocar. A Evolution possui a chave da mensagem e devolve o arquivo
  // descriptografado; mantemos uma cópia estável no Storage da Inbox.
  if (
    provider.name === 'evolution'
    && inbound.contentType
    && inbound.contentType !== 'text'
    && inboundMediaProvider.downloadInboundMedia
  ) {
    try {
      const media = await inboundMediaProvider.downloadInboundMedia(payload);
      if (media) {
        const path = 'inbound/' + inbound.messageId + '/' + safeFileName(media.fileName);
        const { error: uploadError } = await admin.storage
          .from(INBOUND_MEDIA_BUCKET)
          .upload(path, media.bytes, { contentType: media.mime, upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        inbound.mediaUrl = admin.storage.from(INBOUND_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      }
    } catch (error) {
      console.log(JSON.stringify({
        event: 'evolution_media_download_failed',
        message_id: inbound.messageId,
        message: error instanceof Error ? error.message : String(error),
      }));
      // Não perdemos a conversa inteira por indisponibilidade temporária da mídia.
      inbound.mediaUrl = null;
    }
  }

  // Mensagem enviada pela própria conta. Na rota não-oficial isso quase sempre
  // significa que o DONO respondeu pelo celular, fora do CRM — e nesse caso a
  // conversa passou a ser dele. Descartar o evento (o que se fazia antes)
  // deixava a IA sem saber, e ela seguia respondendo por cima do humano.
  //
  // Não cria contato nem conversa: se não existe conversa, não há nada de onde
  // a IA pudesse se intrometer.
  if (inbound.isFromMe) {
    if (provider.name === 'zernio') {
      return jsonResponse({ ok: true, skipped: 'echo' });
    }
    const phone = toE164(inbound.from);
    const { data: contact } = await admin
      .from('contacts').select('id').eq('phone', phone).maybeSingle();
    if (!contact) return jsonResponse({ ok: true, skipped: 'echo sem contato' });

    const { data: conv } = await admin
      .from('conversations').select('id, ai_paused')
      .eq('contact_id', (contact as { id: string }).id)
      .eq('department_id', departmentId)
      .maybeSingle();
    if (!conv) return jsonResponse({ ok: true, skipped: 'echo sem conversa' });

    const conversationId = (conv as { id: string }).id;

    // Registra o que foi dito pelo celular, para a thread do CRM refletir a
    // conversa real. Dedup pelo id da mensagem (índice em zernio_message_id).
    await admin.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: 'operator',
      content_type: inbound.contentType ?? 'text',
      content: inbound.text,
      media_url: inbound.mediaUrl ?? null,
      zernio_message_id: `${provider.name}:${inbound.messageId}`,
      meta_status: 'sent',
      is_private_note: false,
    });

    if ((conv as { ai_paused: boolean }).ai_paused !== true) {
      await admin
        .from('conversations')
        .update({ ai_paused: true, status: 'human_active', last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
      console.log(JSON.stringify({ event: 'ai_paused_by_owner_reply', conversation_id: conversationId }));
    }
    return jsonResponse({ ok: true, owner_reply: true, conversation_id: conversationId });
  }

  // Idempotência por messageId (reusa webhook_events; chave prefixada por provider).
  const dedupKey = `${provider.name}:msg:${inbound.messageId}`;
  const { error: dupErr } = await admin
    .from('webhook_events')
    .insert({ zernio_event_id: dedupKey, event_type: 'message.received' });
  if (dupErr) {
    if ((dupErr as { code?: string }).code === '23505') {
      return jsonResponse({ ok: true, deduped: true });
    }
    console.log(JSON.stringify({ event: 'webhook_event_insert_failed', message: dupErr.message }));
  }
  const releaseDedup = async () => {
    if (!dupErr) {
      await admin.from('webhook_events').delete().eq('zernio_event_id', dedupKey);
    }
  };

  // Resolve/cria contato por telefone.
  const phone = toE164(inbound.from);
  let contactId: string | null = null;
  {
    const { data: existing } = await admin
      .from('contacts').select('id').eq('phone', phone).maybeSingle();
    if (existing) contactId = (existing as { id: string }).id;
    else {
      const { data: created, error } = await admin
        .from('contacts')
        .insert({ phone, name: inbound.senderName ?? null, source: 'whatsapp' })
        .select('id').single();
      if (error) {
        await releaseDedup();
        return jsonResponse({ ok: false, error: `contato: ${error.message}` }, { status: 500 });
      }
      contactId = (created as { id: string }).id;
    }
  }

  // Inbox: mensagens da Evolution viram conversa — o channel guarda o nome do
  // provider, para que a resposta saia pelo mesmo caminho. O Zernio NÃO passa
  // por aqui: o zernio-webhook já cuida do inbox dele; duplicar criaria
  // mensagens em dobro.
  if (provider.name !== 'zernio') {
    let conversationId: string | null = null;
    const { data: existingConv } = await admin
      .from('conversations').select('id')
      .eq('contact_id', contactId)
      .eq('department_id', departmentId)
      .maybeSingle();
    if (existingConv) conversationId = (existingConv as { id: string }).id;
    else {
      const { data: createdConv, error: conversationError } = await admin
        .from('conversations')
        .insert({
          contact_id: contactId,
          status: 'ai_active',
          channel: provider.name,
          department_id: departmentId,
          connection_id: connectionId,
          assigned_to: assignTo,
          assigned_at: assignTo ? new Date().toISOString() : null,
          last_message_at: new Date().toISOString(),
        })
        .select('id').single();
      if (conversationError) {
        await releaseDedup();
        return jsonResponse(
          { ok: false, error: `conversa: ${conversationError.message}` },
          { status: 500 },
        );
      }
      conversationId = (createdConv as { id: string } | null)?.id ?? null;
    }
    if (conversationId) {
      const { error: msgErr } = await admin.from('messages').insert({
        conversation_id: conversationId,
        direction: 'inbound',
        sender_type: 'contact',
        content_type: inbound.contentType ?? 'text',
        content: inbound.text,
        media_url: inbound.mediaUrl ?? null,
        zernio_message_id: `${provider.name}:${inbound.messageId}`,
        is_private_note: false,
      });
      if (!msgErr) {
        await admin
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversationId);
        await admin.rpc('increment_unread_count', { p_conversation_id: conversationId });
      } else if ((msgErr as { code?: string }).code !== '23505') {
        await releaseDedup();
        console.log(JSON.stringify({ event: 'inbound_message_insert_failed', provider: provider.name, message: msgErr.message }));
        return jsonResponse({ ok: false, error: `mensagem: ${msgErr.message}` }, { status: 500 });
      }
    }
  }

  // Reconciliação de atribuição via RPC (CTWA > código > whatsapp_direto).
  const referral = provider.extractReferral(payload);
  const { data: result, error: rpcErr } = await admin.rpc('attribute_inbound_lead', {
    p_contact_id: contactId,
    p_text: inbound.text ?? '',
    p_referral: referral ?? null,
    p_provider: provider.name,
  });
  if (rpcErr) {
    await releaseDedup();
    return jsonResponse({ ok: false, error: `atribuição: ${rpcErr.message}` }, { status: 500 });
  }

  console.log(JSON.stringify({ event: 'lead_attributed', provider: provider.name, result }));
  return jsonResponse({ ok: true, provider: provider.name, attribution: result });
}

Deno.serve(handleInbound);
