// ============================================================================
// check-sla  (cron target, 5min)
// ----------------------------------------------------------------------------
// Varre conversas onde a IA não está tratando o atendimento (status
// 'human_active') e a última mensagem é do contato (inbound) — ou seja, o
// lead está esperando um humano responder. Quando o tempo de espera passa de
// `app_settings.sla_minutes`, dispara uma notificação tipo 'sla_breach' para
// o responsável (assigned_to) ou, sem responsável, para quem opera o
// departamento — mesmo padrão de fanout do handoff.
//
// Dedup: só notifica uma vez por "episódio de espera". Se já existe uma
// notificação sla_breach não lida para a conversa, não duplica a cada tick.
// O episódio se resolve (e pode notificar de novo) quando a conversa recebe
// uma resposta humana (channel muda pra outbound) ou a notificação é lida.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';

interface ConversationRow {
  id: string;
  assigned_to: string | null;
  department_id: string | null;
  last_message_at: string | null;
  contact_id: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireServiceRole(req);
  } catch {
    return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data: settings, error: settingsErr } = await admin
    .from('app_settings')
    .select('sla_minutes')
    .eq('id', 1)
    .maybeSingle();
  if (settingsErr) return jsonResponse({ ok: false, error: settingsErr.message }, { status: 500 });
  const slaMinutes = (settings as { sla_minutes: number } | null)?.sla_minutes ?? 15;
  const cutoff = new Date(Date.now() - slaMinutes * 60_000).toISOString();

  // Só conversas com humano no comando, aguardando resposta há mais que o
  // SLA. A última mensagem sendo inbound é garantida indiretamente: se o
  // humano tivesse respondido, last_message_at teria avançado para a
  // resposta dele — então checamos direto na tabela messages.
  const { data: candidates, error: convErr } = await admin
    .from('conversations')
    .select('id, assigned_to, department_id, last_message_at, contact_id')
    .eq('status', 'human_active')
    .lte('last_message_at', cutoff)
    .limit(200);
  if (convErr) return jsonResponse({ ok: false, error: convErr.message }, { status: 500 });

  const rows = (candidates ?? []) as ConversationRow[];
  if (rows.length === 0) return jsonResponse({ ok: true, checked: 0, notified: 0 });

  let notified = 0;
  const errors: string[] = [];

  for (const conv of rows) {
    // Confirma que a última mensagem de fato é do contato (inbound) — uma
    // nota privada ou uma resposta do humano não conta como "aguardando".
    const { data: lastMsg } = await admin
      .from('messages')
      .select('direction, is_private_note')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = lastMsg as { direction: string; is_private_note: boolean } | null;
    if (!last || last.direction !== 'inbound') continue;

    // Dedup: já existe um aviso não lido pra essa conversa neste episódio?
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('conversation_id', conv.id)
      .eq('type', 'sla_breach')
      .eq('is_read', false)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const { data: contact } = await admin
      .from('contacts')
      .select('name, phone')
      .eq('id', conv.contact_id)
      .maybeSingle();
    const contactRow = contact as { name: string | null; phone: string | null } | null;
    const label = contactRow?.name?.trim() || contactRow?.phone || 'contato';
    const title = `SLA estourado: ${label}`;
    const body = `Esperando resposta humana há mais de ${slaMinutes} min.`;

    if (conv.assigned_to) {
      const { error: insErr } = await admin.from('notifications').insert({
        user_id: conv.assigned_to,
        type: 'sla_breach',
        conversation_id: conv.id,
        title,
        body,
      });
      if (insErr) { errors.push(`conv ${conv.id}: ${insErr.message}`); continue; }
      notified += 1;
      continue;
    }

    // Sem responsável: avisa todo mundo que opera o departamento da conversa
    // (mesmo recorte de _fanout_notification, reaproveitado aqui via query
    // direta porque essa função SQL não está exposta para leitura por Edge
    // Function via RPC pública).
    const { data: operators } = await admin
      .from('app_users')
      .select('user_id, role, department_id')
      .in('role', ['super_admin', 'admin', 'supervisor', 'operator']);
    const eligible = ((operators ?? []) as Array<{ user_id: string; role: string; department_id: string | null }>)
      .filter((u) => u.role === 'super_admin' || u.role === 'admin' || u.department_id === conv.department_id);
    if (eligible.length === 0) continue;
    const { error: insErr } = await admin.from('notifications').insert(
      eligible.map((u) => ({
        user_id: u.user_id,
        type: 'sla_breach',
        conversation_id: conv.id,
        title,
        body,
      })),
    );
    if (insErr) { errors.push(`conv ${conv.id}: ${insErr.message}`); continue; }
    notified += 1;
  }

  return jsonResponse({ ok: true, checked: rows.length, notified, errors });
});
