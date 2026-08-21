import { requireCaller, AuthError } from '../_shared/auth.ts';
import { canOperate } from '../_shared/roles.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { sendEvolutionPresence, sendEvolutionReaction } from '../_shared/whatsapp/outbound.ts';

interface Payload { action?: 'presence' | 'reaction'; conversation_id?: string; message_id?: string; emoji?: string; presence?: 'composing' | 'paused'; }

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const caller = await requireCaller(req);
    if (!canOperate(caller.role)) return jsonResponse({ ok: false, error: 'Sem permissao.' }, { status: 403 });
    const body = (await req.json()) as Payload;
    const conversationId = body.conversation_id?.trim();
    if (!conversationId) return jsonResponse({ ok: false, error: 'conversation_id ausente.' }, { status: 400 });
    const admin = getAdminClient();
    const { data: conv } = await admin.from('conversations').select('contact_id, channel, connection_id').eq('id', conversationId).maybeSingle();
    if (!conv) return jsonResponse({ ok: false, error: 'Conversa nao encontrada.' }, { status: 404 });
    const row = conv as { contact_id: string; channel: string | null; connection_id: string | null };
    if (row.channel !== 'evolution') return jsonResponse({ ok: true, skipped: true });
    const { data: contact } = await admin.from('contacts').select('phone').eq('id', row.contact_id).maybeSingle();
    const phone = (contact as { phone?: string } | null)?.phone;
    if (!phone) return jsonResponse({ ok: false, error: 'Contato sem telefone.' }, { status: 400 });

    if (body.action === 'presence') {
      await sendEvolutionPresence(phone, body.presence === 'paused' ? 'paused' : 'composing', row.connection_id);
      return jsonResponse({ ok: true });
    }

    if (body.action === 'reaction') {
      const messageId = body.message_id?.trim();
      const emoji = body.emoji?.trim() ?? '';
      if (!messageId) return jsonResponse({ ok: false, error: 'message_id ausente.' }, { status: 400 });
      const { data: message } = await admin.from('messages').select('id, conversation_id, direction, zernio_message_id, reactions').eq('id', messageId).maybeSingle();
      if (!message || message.conversation_id !== conversationId) return jsonResponse({ ok: false, error: 'Mensagem invalida.' }, { status: 404 });
      const externalId = String(message.zernio_message_id ?? '').replace(/^evolution:/, '');
      if (!externalId) return jsonResponse({ ok: false, error: 'Mensagem sem ID da Evolution.' }, { status: 400 });
      await sendEvolutionReaction(phone, externalId, emoji, message.direction === 'outbound', row.connection_id);
      const current = Array.isArray(message.reactions) ? message.reactions as Array<Record<string, unknown>> : [];
      const reactions = current.filter((item) => item.user_id !== caller.userId);
      if (emoji) reactions.push({ emoji, user_id: caller.userId, created_at: new Date().toISOString() });
      const { error } = await admin.from('messages').update({ reactions }).eq('id', messageId);
      if (error) throw error;
      return jsonResponse({ ok: true, reactions });
    }
    return jsonResponse({ ok: false, error: 'Acao invalida.' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
});