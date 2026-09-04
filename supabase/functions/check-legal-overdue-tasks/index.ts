// ============================================================================
// check-legal-overdue-tasks  (cron target, 15min)
// ----------------------------------------------------------------------------
// Varre tarefas de processo jurídico (legal_case_tasks) com due_at vencido e
// ainda não concluídas. Dispara notificação 'legal_task_overdue' pro
// responsável (owner_id) ou, sem responsável, pra quem tem acesso ao módulo
// Jurídico (super_admin/admin + supervisor de departamento com
// grants_legal_access) — mesmo padrão de fanout de check-sla.
//
// Dedup: só notifica se não existir uma notificação 'legal_task_overdue' NÃO
// LIDA pra aquela tarefa. Reabre sozinho quando o operador marca como lida e
// a tarefa segue atrasada (nagging desejado, mesmo comportamento do SLA).
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';

interface TaskRow {
  id: string;
  case_id: string;
  title: string;
  due_at: string;
  owner_id: string | null;
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
  const nowIso = new Date().toISOString();

  const { data: candidates, error: taskErr } = await admin
    .from('legal_case_tasks')
    .select('id, case_id, title, due_at, owner_id')
    .not('due_at', 'is', null)
    .lt('due_at', nowIso)
    .eq('done', false)
    .limit(200);
  if (taskErr) return jsonResponse({ ok: false, error: taskErr.message }, { status: 500 });

  const rows = (candidates ?? []) as TaskRow[];
  if (rows.length === 0) return jsonResponse({ ok: true, checked: 0, notified: 0 });

  let notified = 0;
  const errors: string[] = [];
  let legalRecipients: string[] | null = null;

  for (const task of rows) {
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('task_id', task.id)
      .eq('type', 'legal_task_overdue')
      .eq('is_read', false)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const { data: legalCase } = await admin
      .from('legal_cases')
      .select('title')
      .eq('id', task.case_id)
      .maybeSingle();
    const caseTitle = (legalCase as { title: string } | null)?.title ?? 'processo';
    const title = `Tarefa atrasada: ${task.title}`;
    const body = `${caseTitle} — venceu em ${new Date(task.due_at).toLocaleString('pt-BR')}.`;

    if (task.owner_id) {
      const { error: insErr } = await admin.from('notifications').insert({
        user_id: task.owner_id,
        type: 'legal_task_overdue',
        task_id: task.id,
        title,
        body,
      });
      if (insErr) { errors.push(`task ${task.id}: ${insErr.message}`); continue; }
      notified += 1;
      continue;
    }

    // Sem responsável: avisa quem tem acesso ao módulo Jurídico (buscado uma
    // vez só, reaproveitado pras demais tarefas sem dono nesta execução).
    if (legalRecipients === null) {
      const { data: departments } = await admin
        .from('departments')
        .select('id')
        .eq('grants_legal_access', true);
      const legalDeptIds = new Set(((departments ?? []) as Array<{ id: string }>).map((d) => d.id));

      const { data: operators } = await admin
        .from('app_users')
        .select('user_id, role, department_id')
        .in('role', ['super_admin', 'admin', 'supervisor']);
      legalRecipients = ((operators ?? []) as Array<{ user_id: string; role: string; department_id: string | null }>)
        .filter((u) => u.role === 'super_admin' || u.role === 'admin' || (u.department_id && legalDeptIds.has(u.department_id)))
        .map((u) => u.user_id);
    }
    if (legalRecipients.length === 0) continue;

    const { error: insErr } = await admin.from('notifications').insert(
      legalRecipients.map((userId) => ({
        user_id: userId,
        type: 'legal_task_overdue',
        task_id: task.id,
        title,
        body,
      })),
    );
    if (insErr) { errors.push(`task ${task.id}: ${insErr.message}`); continue; }
    notified += 1;
  }

  return jsonResponse({ ok: true, checked: rows.length, notified, errors });
});
