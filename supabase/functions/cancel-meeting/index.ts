// cancel-meeting — apaga o evento no Google Calendar, cancela o bot da
// Recall.ai (se ainda não tiver entrado na chamada) e marca a reunião como
// 'canceled'. Não faz DELETE da linha: o acervo mantém o histórico de que a
// reunião existiu e foi cancelada, em vez de sumir sem rastro.

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { deleteMeetEvent } from '../_shared/google-calendar.ts';
import { cancelRecallBot } from '../_shared/recall.ts';

interface Payload {
  meeting_id?: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireCaller(req);

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    const meetingId = body.meeting_id?.trim();
    if (!meetingId) return jsonResponse({ ok: false, error: 'meeting_id ausente.' }, { status: 400 });

    const admin = getAdminClient();
    const { data: meeting, error: fetchError } = await admin
      .from('meetings')
      .select('id, created_by, google_event_id, recall_bot_id, status')
      .eq('id', meetingId)
      .maybeSingle();
    if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, { status: 500 });
    if (!meeting) return jsonResponse({ ok: false, error: 'Reunião não encontrada.' }, { status: 404 });

    const row = meeting as { id: string; created_by: string | null; google_event_id: string | null; recall_bot_id: string | null; status: string };
    const isOwner = row.created_by === caller.userId;
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    if (!isOwner && !isAdmin) {
      return jsonResponse({ ok: false, error: 'Só quem agendou (ou um admin) pode cancelar.' }, { status: 403 });
    }
    if (row.status === 'canceled') {
      return jsonResponse({ ok: true, already_canceled: true });
    }

    if (row.google_event_id) await deleteMeetEvent(row.google_event_id);
    if (row.recall_bot_id) await cancelRecallBot(row.recall_bot_id);

    const { error: updateError } = await admin
      .from('meetings')
      .update({ status: 'canceled' })
      .eq('id', meetingId);
    if (updateError) return jsonResponse({ ok: false, error: updateError.message }, { status: 500 });

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('cancel-meeting error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
