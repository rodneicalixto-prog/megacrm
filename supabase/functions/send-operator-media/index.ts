// ============================================================================
// send-operator-media
// ----------------------------------------------------------------------------
// Operador anexa uma mídia (imagem/áudio/vídeo/documento) numa conversa. O
// arquivo chega como multipart/form-data; persistimos a linha (content_type +
// media_url) para o thread renderizar. Nenhuma credencial toca o browser.
//
// Dois caminhos, escolhidos pelo `channel` da conversa — o mesmo desvio que o
// send-operator-message já faz para texto:
//
//   · Zernio    → /media/upload-direct devolve a URL; envia com attachmentUrl.
//   · Evolution → não existe upload no provedor. O arquivo vai para o bucket
//                 whatsapp-hub-outbound-media (público) e a URL serve tanto ao
//                 /message/sendMedia quanto à thread do CRM.
//
// Notas privadas NÃO passam por aqui — são texto e nunca saem do CRM.
// ============================================================================

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { canOperate } from '../_shared/roles.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  ZernioError,
  createInboxConversation,
  loadZernioContext,
  sendInboxMessage,
  uploadMediaDirect,
} from '../_shared/zernio.ts';
import { isEvolutionChannel, sendEvolutionMessage } from '../_shared/whatsapp/outbound.ts';

const OUTBOUND_BUCKET = 'whatsapp-hub-outbound-media';

const MAX_BYTES = 25 * 1024 * 1024;

function classify(mime: string): 'image' | 'audio' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

// Handler exportado para poder ser exercitado fora do runtime — ver
// whatsapp-inbound, mesmo motivo.
export async function handleOperatorMedia(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireCaller(req);
    if (!canOperate(caller.role)) {
      return jsonResponse({ ok: false, error: 'Sem permissão para enviar mensagens.' }, { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonResponse({ ok: false, error: 'Esperado multipart/form-data.' }, { status: 400 });
    }

    const conversationId = String(form.get('conversation_id') ?? '').trim();
    const caption = String(form.get('content') ?? '').trim();
    const voiceNote = String(form.get('voice_note') ?? '') === 'true';
    const file = form.get('file');

    if (!conversationId) {
      return jsonResponse({ ok: false, error: 'conversation_id ausente.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'Arquivo ausente.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return jsonResponse({ ok: false, error: 'Arquivo excede 25MB.' }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .select('id, contact_id, zernio_conversation_id, channel, department_id, connection_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) return jsonResponse({ ok: false, error: convErr.message }, { status: 500 });
    if (!conv) return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
    const convRow = conv as {
      id: string;
      contact_id: string;
      zernio_conversation_id: string | null;
      channel: string | null;
      department_id: string | null;
      connection_id: string | null;
    };

    const contentType = classify(file.type || '');
    const mime = file.type || 'application/octet-stream';
    const filename = voiceNote ? 'voice-note.ogg' : (file.name || `arquivo-${contentType}`);
    const bytes = new Uint8Array(await file.arrayBuffer());

    // ---- Rota não-oficial (Evolution) ------------------------------------
    if (isEvolutionChannel(convRow.channel)) {
      const { data: contactRow } = await admin
        .from('contacts').select('phone').eq('id', convRow.contact_id).maybeSingle();
      const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
      if (!phone) return jsonResponse({ ok: false, error: 'Contato sem telefone.' }, { status: 400 });

      // Nome único: o mesmo arquivo enviado duas vezes não pode se sobrescrever.
      const path = `${conversationId}/${crypto.randomUUID()}-${filename}`;
      const { error: upErr } = await admin.storage
        .from(OUTBOUND_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) {
        return jsonResponse({ ok: false, error: `upload: ${upErr.message}` }, { status: 502 });
      }
      const { data: pub } = admin.storage.from(OUTBOUND_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      let evolutionMessageId: string | null = null;
      try {
        const sent = await sendEvolutionMessage(phone, caption, publicUrl, contentType, convRow.connection_id);
        evolutionMessageId = sent.messageId;
      } catch (err) {
        // O arquivo já está no bucket; sem o envio ele viraria lixo silencioso.
        await admin.storage.from(OUTBOUND_BUCKET).remove([path]);
        return jsonResponse(
          { ok: false, error: err instanceof Error ? err.message : 'Falha ao enviar mídia.' },
          { status: 502 },
        );
      }

      const { data: row, error: insErr } = await admin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          direction: 'outbound',
          sender_type: 'operator',
          sender_id: caller.userId,
          content_type: contentType,
          content: caption || null,
          media_url: publicUrl,
          zernio_message_id: evolutionMessageId ? `evolution:${evolutionMessageId}` : null,
          meta_status: 'sent',
          is_private_note: false,
        })
        .select('id').single();
      if (insErr) return jsonResponse({ ok: false, error: insErr.message }, { status: 500 });

      await admin
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          status: 'human_active',
          ai_paused: true,
          assigned_to: caller.userId,
        })
        .eq('id', conversationId);

      return jsonResponse({
        ok: true,
        message_id: (row as { id: string }).id,
        media_url: publicUrl,
        sent_via: 'evolution',
      });
    }

    // ---- Rota oficial (Zernio) -------------------------------------------
    const ctx = await loadZernioContext();

    // 1. Sobe a mídia ao Zernio.
    const mediaUrl = await uploadMediaDirect({ apiKey: ctx.apiKey, bytes, filename, contentType: mime });

    // 2. Resolve a conversa 1:1 no Zernio (cria pelo telefone se necessário).
    let zernioConversationId = convRow.zernio_conversation_id;
    if (!zernioConversationId) {
      const { data: contactRow } = await admin
        .from('contacts')
        .select('phone')
        .eq('id', convRow.contact_id)
        .maybeSingle();
      const phone = (contactRow as { phone?: string } | null)?.phone ?? null;
      if (!phone) return jsonResponse({ ok: false, error: 'Contato sem telefone.' }, { status: 400 });
      const created = await createInboxConversation({ apiKey: ctx.apiKey, accountId: ctx.accountId, participantId: phone });
      zernioConversationId = created.conversationId;
      if (zernioConversationId) {
        await admin.from('conversations').update({ zernio_conversation_id: zernioConversationId }).eq('id', conversationId);
      }
    }
    if (!zernioConversationId) {
      return jsonResponse({ ok: false, error: 'Não foi possível resolver a conversa no Zernio.' }, { status: 502 });
    }

    // 3. Envia a mensagem de mídia.
    const sent = await sendInboxMessage({
      apiKey: ctx.apiKey,
      accountId: ctx.accountId,
      conversationId: zernioConversationId,
      attachmentUrl: mediaUrl,
      voiceNote,
      text: caption || undefined,
    });

    // 4. Persiste a linha (media_url = url do Zernio, baixável pelo thread).
    const { data: inserted, error: insErr } = await admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'operator',
        sender_id: caller.userId,
        content_type: contentType,
        content: caption || null,
        media_url: mediaUrl,
        zernio_message_id: sent.messageId,
        meta_status: 'sent',
        is_private_note: false,
      })
      .select('id')
      .single();
    if (insErr) return jsonResponse({ ok: false, error: insErr.message }, { status: 500 });

    await admin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        status: 'human_active',
        ai_paused: true,
        assigned_to: caller.userId,
      })
      .eq('id', conversationId);

    return jsonResponse({
      ok: true,
      message_id: (inserted as { id: string }).id,
      media_url: mediaUrl,
      sent_to_zernio: true,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof ZernioError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    console.error('send-operator-media error', err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
}

Deno.serve(handleOperatorMedia);
