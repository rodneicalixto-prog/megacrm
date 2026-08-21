// Reparação autenticada de mídia Evolution já persistida com URL criptografada.
// Quando o player falha, buscamos o original, copiamos para o Storage e
// atualizamos a mensagem para que os próximos acessos usem a URL estável.

import { AuthError, requireCaller } from '../_shared/auth.ts';
import { canOperate } from '../_shared/roles.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { connectionForConversation, providerFor } from '../_shared/whatsapp/department-routing.ts';

const MEDIA_BUCKET = 'whatsapp-hub-outbound-media';

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'media.bin';
}

export async function handleResolveInboundMedia(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const caller = await requireCaller(req);
    if (!canOperate(caller.role)) {
      return jsonResponse({ ok: false, error: 'Sem permissão para acessar mídia.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as { message_id?: unknown };
    const messageId = typeof body.message_id === 'string' ? body.message_id.trim() : '';
    if (!messageId) {
      return jsonResponse({ ok: false, error: 'message_id ausente.' }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: message, error: messageError } = await admin
      .from('messages')
      .select('id, conversation_id, content_type, media_url, zernio_message_id')
      .eq('id', messageId)
      .maybeSingle();
    if (messageError) return jsonResponse({ ok: false, error: messageError.message }, { status: 500 });
    if (!message) return jsonResponse({ ok: false, error: 'Mensagem não encontrada.' }, { status: 404 });

    const row = message as {
      id: string;
      conversation_id: string;
      content_type: string;
      media_url: string | null;
      zernio_message_id: string | null;
    };
    if (!['audio', 'image', 'video', 'document'].includes(row.content_type)) {
      return jsonResponse({ ok: false, error: 'A mensagem não contém mídia.' }, { status: 400 });
    }

    const externalId = row.zernio_message_id?.replace(/^evolution:/, '') ?? '';
    if (!externalId || externalId === row.zernio_message_id) {
      return jsonResponse({ ok: false, error: 'Mensagem não pertence à Evolution.' }, { status: 400 });
    }

    const { data: conversation } = await admin
      .from('conversations')
      .select('connection_id, department_id, contact_id')
      .eq('id', row.conversation_id)
      .maybeSingle();
    if (!conversation) return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });

    const conv = conversation as {
      connection_id: string | null;
      department_id: string | null;
      contact_id: string;
    };
    const { data: contact } = await admin
      .from('contacts')
      .select('phone')
      .eq('id', conv.contact_id)
      .maybeSingle();
    const phone = ((contact as { phone?: string } | null)?.phone ?? '').replace(/\D/g, '');

    const connection = await connectionForConversation(conv.connection_id, conv.department_id);
    if (!connection) {
      return jsonResponse({ ok: false, error: 'Conexão Evolution indisponível.' }, { status: 503 });
    }

    const media = await providerFor(connection).downloadInboundMedia({
      data: {
        key: {
          id: externalId,
          remoteJid: phone ? phone + '@s.whatsapp.net' : undefined,
          fromMe: false,
        },
      },
    });
    if (!media) return jsonResponse({ ok: false, error: 'Mídia não localizada na Evolution.' }, { status: 404 });

    const path = 'inbound/' + externalId + '/' + safeFileName(media.fileName);
    const { error: uploadError } = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(path, media.bytes, { contentType: media.mime, upsert: true });
    if (uploadError) return jsonResponse({ ok: false, error: uploadError.message }, { status: 502 });

    const publicUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
    const { error: updateError } = await admin
      .from('messages')
      .update({ media_url: publicUrl })
      .eq('id', row.id);
    if (updateError) return jsonResponse({ ok: false, error: updateError.message }, { status: 500 });

    return jsonResponse({ ok: true, media_url: publicUrl });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('resolve-inbound-media error', error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    );
  }
}

Deno.serve(handleResolveInboundMedia);