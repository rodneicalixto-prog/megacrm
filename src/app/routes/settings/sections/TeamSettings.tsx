import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BriefcaseBusiness, Building2, ChevronDown, Loader2, Mail, Power, UserRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { canSeeAdminNav } from '@/app/layout/nav-config';
import { Avatar } from '@/components/ui/Avatar';
import { useDepartments } from '@/hooks/useDepartments';

type Role = 'super_admin' | 'admin' | 'supervisor' | 'operator';

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Owner',
  admin: 'Admin',
  supervisor: 'Supervisor',
  operator: 'Operador',
};

// supabase.functions.invoke zera `data` em respostas não-2xx (o erro vira
// FunctionsHttpError com o Response em `.context`). Lê o corpo pra mostrar a
// mensagem amigável da função (ex.: "Já existe um usuário com esse e-mail")
// em vez do genérico "Edge Function returned a non-2xx status code".
async function invokeErrorMessage(error: unknown, data: { error?: string } | null): Promise<string> {
  if (data?.error) return data.error;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* corpo não-JSON */
    }
  }
  return (error as { message?: string } | null)?.message ?? 'Erro desconhecido';
}

interface MemberRow {
  id: string;
  role: Role;
  user_id: string;
  email: string | null;
  full_name: string | null;
  department_id: string | null;
  department_name: string | null;
  position_names: string[];
  accepted_at: string | null;
  invite_accepted_at: string | null;
  is_active: boolean;
}

function canManageMember(caller: Role | null, target: Role): boolean {
  if (caller === 'super_admin') return target !== 'super_admin';
  if (caller === 'admin') return target === 'supervisor' || target === 'operator';
  return false;
}

export function TeamSettings() {
  const { userId, role: callerRole } = useAppUser();
  // Backend (invite-team-member/delete-team-member) já aceita super_admin via
  // requireAdmin (ADMIN_ROLES = [super_admin, admin]); a comparação literal
  // com 'admin' escondia o form de convite e o botão de remover do próprio
  // dono da instalação (super_admin) — mesma classe de bug já corrigida em
  // CredentialsPage/AIAgentPage/FunilPage/LeadAssignmentSettings.
  const isOwner = canSeeAdminNav(callerRole);
  const { departments } = useDepartments();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [departmentId, setDepartmentId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set());

  const loadAll = async () => {
    if (!userId) return;
    const supabase = getSupabase();

    // app_users tem só user_id; os e-mails vêm da RPC list_operators (join com
    // auth.users, SECURITY DEFINER). Merge por user_id.
    const [membersRes, opsRes, positionsRes] = await Promise.all([
      supabase
        .from('app_users')
        .select('id, role, user_id, accepted_at, invite_accepted_at, is_active')
        .order('invited_at', { ascending: true }),
      supabase.schema('whatsapp_hub').rpc('list_operators'),
      supabase
        .from('department_positions')
        .select('user_id, name')
        .not('user_id', 'is', null)
        .order('name'),
    ]);

    if (membersRes.error) {
      toast.error('Não foi possível carregar a equipe', {
        description: membersRes.error.message,
      });
    } else {
      const operatorByUser = new Map<string, {
        email: string;
        full_name: string | null;
        department_id: string | null;
        department_name: string | null;
      }>(
        ((opsRes.data ?? []) as Array<{
          user_id: string;
          email: string;
          full_name: string | null;
          department_id: string | null;
          department_name: string | null;
        }>).map((operator) => [operator.user_id, operator]),
      );
      const positionsByUser = new Map<string, string[]>();
      for (const position of (positionsRes.data ?? []) as Array<{ user_id: string; name: string }>) {
        const current = positionsByUser.get(position.user_id) ?? [];
        current.push(position.name);
        positionsByUser.set(position.user_id, current);
      }
      const nextMembers = (membersRes.data ?? []).map((row) => {
        const operator = operatorByUser.get(row.user_id as string);
        return {
          id: row.id as string,
          role: row.role as Role,
          user_id: row.user_id as string,
          email: operator?.email ?? null,
          full_name: operator?.full_name ?? null,
          department_id: operator?.department_id ?? null,
          department_name: operator?.department_name ?? null,
          position_names: positionsByUser.get(row.user_id as string) ?? [],
          accepted_at: (row.accepted_at as string | null) ?? null,
          invite_accepted_at: (row.invite_accepted_at as string | null) ?? null,
          is_active: (row.is_active as boolean | null) ?? true,
        };
      });
      setMembers(nextMembers);
      setExpandedDepartments((current) => {
        if (current.size > 0) return current;
        return new Set(nextMembers.map((member) => member.department_id ?? 'unassigned'));
      });
    }

    setLoading(false);
  };

  const membersByDepartment = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; members: MemberRow[] }>();
    for (const member of members) {
      const id = member.department_id ?? 'unassigned';
      const group = grouped.get(id) ?? {
        id,
        name: member.department_name ?? 'Sem departamento',
        members: [],
      };
      group.members.push(member);
      grouped.set(id, group);
    }
    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        members: group.members.sort((a, b) =>
          (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '', 'pt-BR'),
        ),
      }))
      .sort((a, b) => {
        if (a.id === 'unassigned') return 1;
        if (b.id === 'unassigned') return -1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [members]);

  const toggleDepartment = (id: string) => {
    setExpandedDepartments((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isOwner]);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Informe um e-mail.');
      return;
    }

    setInviting(true);
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('invite-team-member', {
      // app_url = domínio atual (produção na Vercel) para o link do e-mail não
      // cair em localhost. Sem department_id, o trigger cai no setor padrão —
      // ruim pra supervisor/operator, que deveriam nascer no setor certo.
      body: {
        email: email.trim(),
        role,
        app_url: window.location.origin,
        ...(departmentId ? { department_id: departmentId } : {}),
      },
    });
    setInviting(false);

    if (error || !data?.ok) {
      toast.error('Falha ao enviar convite', {
        description: await invokeErrorMessage(error, data),
      });
      return;
    }

    toast.success(`Convite enviado para ${email.trim()}`, {
      description: 'O Supabase enviou o e-mail; o convidado define a senha pelo link.',
    });

    setEmail('');
    setDepartmentId('');
    void loadAll();
  };

  const handleRemove = async (member: MemberRow) => {
    const label = member.email ?? member.user_id;
    if (!window.confirm(`Remover ${label} da equipe? Esta ação é irreversível.`)) return;

    setRemovingId(member.user_id);
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('delete-team-member', {
      body: { user_id: member.user_id },
    });
    setRemovingId(null);

    if (error || !data?.ok) {
      toast.error('Falha ao remover membro', {
        description: await invokeErrorMessage(error, data),
      });
      return;
    }

    toast.success(`${label} removido da equipe.`);
    void loadAll();
  };

  const handleToggleActive = async (member: MemberRow) => {
    const nextActive = !member.is_active;
    const label = member.email ?? member.user_id;
    if (!nextActive && !window.confirm(
      `Desativar ${label}? O usuário perderá o acesso, mas seus dados e histórico serão preservados.`,
    )) return;

    setTogglingId(member.user_id);
    const { data, error } = await getSupabase().functions.invoke('set-team-member-active', {
      body: { user_id: member.user_id, active: nextActive },
    });
    setTogglingId(null);

    if (error || !data?.ok) {
      toast.error(nextActive ? 'Falha ao ativar usuário' : 'Falha ao desativar usuário', {
        description: await invokeErrorMessage(error, data),
      });
      return;
    }

    toast.success(`${label} foi ${nextActive ? 'ativado' : 'desativado'}.`);
    setMembers((current) => current.map((item) => (
      item.user_id === member.user_id ? { ...item, is_active: nextActive } : item
    )));
  };

  return (
    <Card>
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-xl font-bold text-display">Equipe</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {isOwner
              ? 'Convide novos membros por e-mail. O Supabase envia o convite e o membro define a senha pelo link.'
              : 'Apenas o owner desta instância pode convidar membros.'}
          </p>
        </header>

        {isOwner && (
          <form
            onSubmit={handleInvite}
            className="grid grid-cols-1 md:grid-cols-[1fr_150px_1fr_auto] gap-3 items-end"
          >
            <div className="space-y-2">
              <Label htmlFor="invite_email">E-mail</Label>
              <Input
                id="invite_email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operador@suaempresa.com"
                disabled={inviting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite_role">Role</Label>
              <select
                id="invite_role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={inviting}
                className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
              >
                {callerRole === 'super_admin' && <option value="super_admin">Owner</option>}
                <option value="admin">Admin</option>
                <option value="supervisor">Supervisor</option>
                <option value="operator">Operador</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite_department">Setor</Label>
              <select
                id="invite_department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                disabled={inviting}
                className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
              >
                <option value="">Padrão</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Convidar
                </>
              )}
            </Button>
          </form>
        )}

        <div className="space-y-2">
          <div className="text-label">Membros atuais</div>
          {loading ? (
            <div className="text-sm text-[var(--color-text-secondary)] opacity-60">
              Carregando...
            </div>
          ) : members.length === 0 ? (
            <div className="text-sm text-[var(--color-text-secondary)] opacity-60">
              Nenhum membro ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {membersByDepartment.map((department) => {
                const expanded = expandedDepartments.has(department.id);
                const activeCount = department.members.filter((member) => member.is_active).length;
                return (
                  <section key={department.id} className="overflow-hidden rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => toggleDepartment(department.id)}
                      aria-expanded={expanded}
                      aria-controls={`team-department-${department.id}`}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.035]"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(59,130,246,0.1)] text-[var(--accent-primary)]">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{department.name}</span>
                        <span className="block text-xs text-[var(--color-text-secondary)]">
                          {department.members.length} membro{department.members.length !== 1 ? 's' : ''} · {activeCount} ativo{activeCount !== 1 ? 's' : ''}
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 text-[var(--color-text-secondary)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                    </button>

                    {expanded && (
                      <ul id={`team-department-${department.id}`} className="divide-y divide-[rgba(59,130,246,0.08)] border-t border-[rgba(59,130,246,0.08)]">
                        {department.members.map((m) => {
                          const displayName = m.full_name?.trim() || m.email || m.user_id;
                          const positionLabel = m.position_names.length > 0
                            ? m.position_names.join(' · ')
                            : ROLE_LABEL[m.role] ?? 'Operador';
                          return (
                            <li key={m.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${m.is_active ? '' : 'bg-white/[0.015]'}`}>
                              <div className="flex min-w-0 items-center gap-3">
                                {displayName ? (
                                  <Avatar name={displayName} size="lg" className={m.is_active ? '' : 'grayscale'} />
                                ) : (
                                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5">
                                    <UserRound className="h-4 w-4 text-[var(--color-text-secondary)]" />
                                  </div>
                                )}
                                <div className="min-w-0 text-sm">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="max-w-[320px] truncate font-semibold text-[var(--color-text-primary)]">{displayName}</span>
                                    {!m.is_active && <span className="rounded-full bg-[rgba(239,68,68,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[#EF4444]">Desativado</span>}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                                    <span className="inline-flex items-center gap-1 font-medium text-[var(--accent-secondary)]">
                                      <BriefcaseBusiness className="h-3 w-3" />
                                      {positionLabel}
                                    </span>
                                    {m.position_names.length > 0 && (
                                      <>
                                        <span aria-hidden="true">•</span>
                                        <span>{ROLE_LABEL[m.role] ?? 'Operador'}</span>
                                      </>
                                    )}
                                    {m.email && m.email !== displayName && <><span aria-hidden="true">•</span><span className="truncate">{m.email}</span></>}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] opacity-75">
                                    {!m.is_active
                                      ? 'Acesso suspenso, histórico preservado'
                                      : m.invite_accepted_at
                                      ? `Ativo desde ${new Date(m.invite_accepted_at).toLocaleDateString('pt-BR')}`
                                      : 'Convite pendente'}
                                  </div>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {canManageMember(callerRole, m.role) && m.user_id !== userId && (
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleActive(m)}
                                    disabled={togglingId === m.user_id}
                                    aria-label={`${m.is_active ? 'Desativar' : 'Ativar'} ${displayName}`}
                                    title={m.is_active ? 'Desativar acesso' : 'Ativar acesso'}
                                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${m.is_active ? 'text-[var(--color-text-secondary)] hover:bg-[rgba(239,68,68,0.12)] hover:text-[#EF4444]' : 'text-[var(--color-success)] hover:bg-[rgba(16,185,129,0.12)]'}`}
                                  >
                                    {togglingId === m.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                                  </button>
                                )}
                                {isOwner && m.user_id !== userId && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemove(m)}
                                    disabled={removingId === m.user_id}
                                    aria-label={`Remover ${displayName}`}
                                    title="Remover membro"
                                    className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[rgba(239,68,68,0.12)] hover:text-[#EF4444] disabled:opacity-50"
                                  >
                                    {removingId === m.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
