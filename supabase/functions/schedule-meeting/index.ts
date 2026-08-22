// schedule-meeting — cria a reunião no Google Calendar (link do Meet
// automático, conta única compartilhada) e, se a Recall.ai estiver
// configurada, agenda o bot de gravação. Roda como service role porque
// meetings não tem policy de INSERT para o client (ver migration).
//
// Sem credenciais do Google configuradas, devolve um erro claro apontando pra
// /settings/credentials — a reunião não é criada pela metade (sem link).

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { canOperate } from '../_shared/roles.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { createMeetEvent } from '../_shared/google-calendar.ts';
import { createRecallBot } from '../_shared/recall.ts';

interface Payload {
  title?: string;
  description?: string;
  department_id?: string | null;
  starts_at?: string;
  ends_at?: string;
  attendees?: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireCaller(req);
    if (!canOperate(caller.role)) {
      return jsonResponse({ ok: false, error: 'Sem permissão para agendar reuniões.' }, { status: 403 });
    }

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    const title = body.title?.trim();
    if (!title) return jsonResponse({ ok: false, error: 'Título é obrigatório.' }, { status: 400 });

    const startsAt = body.starts_at ? new Date(body.starts_at) : null;
    const endsAt = body.ends_at ? new Date(body.ends_at) : null;
    if (!startsAt || isNaN(startsAt.getTime()) || !endsAt || isNaN(endsAt.getTime())) {
      return jsonResponse({ ok: false, error: 'Datas de início/fim inválidas.' }, { status: 400 });
    }
    if (endsAt <= startsAt) {
      return jsonResponse({ ok: false, error: 'O horário de término deve ser depois do início.' }, { status: 400 });
    }

    const attendees = Array.isArray(body.attendees)
      ? body.attendees.map((email) => email.trim()).filter(Boolean)
      : [];
    const invalidEmail = attendees.find((email) => !EMAIL_RE.test(email));
    if (invalidEmail) {
      return jsonResponse({ ok: false, error: `E-mail inválido: ${invalidEmail}` }, { status: 400 });
    }

    const admin = getAdminClient();

    let googleEvent: { eventId: string; meetLink: string | null };
    try {
      googleEvent = await createMeetEvent({
        title,
        description: body.description?.trim() || null,
        startsAtIso: startsAt.toISOString(),
        endsAtIso: endsAt.toISOString(),
        attendees,
      });
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : 'Falha ao criar evento no Google Calendar.' },
        { status: 502 },
      );
    }

    // Gravação é best-effort: se a Recall.ai falhar, a reunião continua
    // criada (o operador ainda tem o link do Meet) — só fica sem bot.
    let recallBotId: string | null = null;
    let recallError: string | null = null;
    try {
      const bot = await createRecallBot({
        meetingUrl: googleEvent.meetLink ?? '',
        joinAtIso: startsAt.toISOString(),
        botName: 'MegaCRM Notetaker',
      });
      recallBotId = bot?.botId ?? null;
    } catch (err) {
      recallError = err instanceof Error ? err.message : 'Falha ao agendar gravação.';
      console.log(JSON.stringify({ event: 'recall_bot_schedule_failed', message: recallError }));
    }

    const { data: inserted, error: insertError } = await admin
      .from('meetings')
      .insert({
        title,
        description: body.description?.trim() || null,
        department_id: body.department_id || null,
        created_by: caller.userId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        attendees,
        status: 'scheduled',
        google_event_id: googleEvent.eventId,
        meet_link: googleEvent.meetLink,
        recall_bot_id: recallBotId,
        error_message: recallError,
      })
      .select()
      .single();

    if (insertError) {
      return jsonResponse({ ok: false, error: `Reunião criada no Google, mas falhou ao salvar: ${insertError.message}` }, { status: 500 });
    }

    return jsonResponse({ ok: true, meeting: inserted, recall_warning: recallError });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('schedule-meeting error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
