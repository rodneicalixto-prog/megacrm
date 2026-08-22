import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Dialog } from '@/components/ui/dialog';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import {
  DISPATCH_CONTACT_STATUS_LABEL,
  MASS_DISPATCH_STATUS_LABEL,
  type MassDispatch,
  type MassDispatchContact,
} from '@/types/massDispatch';

interface DispatchDetailProps {
  dispatch: MassDispatch;
  onClose: () => void;
}

const CHART_BLUE = '#3B82F6';
const CHART_GREEN = '#22C55E';
const CHART_ROSE = '#EF4444';

const PAGE_SIZE = 25;

export function DispatchDetail({ dispatch, onClose }: DispatchDetailProps) {
  const { userId } = useAppUser();
  const [contacts, setContacts] = useState<MassDispatchContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    const supabase = getSupabase();
    (async () => {
      const { data, error, count } = await supabase
        .schema('whatsapp_hub')
        .from('mass_dispatch_contacts')
        .select('*, contact:contact_id(id, name, phone)', { count: 'exact' })
        .eq('dispatch_id', dispatch.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (cancelled) return;
      if (!error) {
        setContacts((data ?? []) as MassDispatchContact[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, dispatch.id, page]);

  const pending = Math.max(0, dispatch.total_contacts - dispatch.sent - dispatch.failed);
  const slices = [
    { name: 'Pendente', value: pending, fill: '#64748B' },
    { name: 'Enviado', value: Math.max(0, dispatch.sent - dispatch.replied), fill: CHART_BLUE },
    { name: 'Respondeu', value: dispatch.replied, fill: CHART_GREEN },
    { name: 'Falhou', value: dispatch.failed, fill: CHART_ROSE },
  ].filter((s) => s.value > 0);

  const replyRate = dispatch.sent > 0 ? Math.round((dispatch.replied / dispatch.sent) * 100) : 0;

  return (
    <Dialog open onClose={onClose} title={dispatch.name} widthClass="max-w-4xl">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold">{MASS_DISPATCH_STATUS_LABEL[dispatch.status]}</span>
          <span>{dispatch.total_contacts} destinatários</span>
          <span>· taxa de resposta {replyRate}%</span>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'Pendente', value: pending, color: '#64748B' },
            { label: 'Enviado', value: dispatch.sent, color: CHART_BLUE },
            { label: 'Respondeu', value: dispatch.replied, color: CHART_GREEN },
            { label: 'Falhou', value: dispatch.failed, color: CHART_ROSE },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-3 text-center">
              <div className="text-label">{s.label}</div>
              <div className="mt-1 text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {slices.length > 0 && (
          <div className="h-56 rounded-lg border border-[rgba(59,130,246,0.1)] bg-white/[0.02] p-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {slices.map((s) => <Cell key={s.name} fill={s.fill} />)}
                </Pie>
                <Legend />
                <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-label">Contatos ({total})</div>
          {loading ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Carregando…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[rgba(59,130,246,0.12)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[rgba(59,130,246,0.12)] text-left text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                    <th className="px-3 py-2">Contato</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Enviado em</th>
                    <th className="px-3 py-2">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id} className="border-b border-[rgba(59,130,246,0.06)] last:border-0">
                      <td className="px-3 py-2">{c.contact?.name || c.contact?.phone || '—'}</td>
                      <td className="px-3 py-2">{DISPATCH_CONTACT_STATUS_LABEL[c.status]}</td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{c.sent_at ? new Date(c.sent_at).toLocaleString('pt-BR') : '—'}</td>
                      <td className="px-3 py-2 text-[#F87171] max-w-[220px] truncate">{c.error_message || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="disabled:opacity-40">← Anterior</button>
              <span>Página {page + 1} de {Math.ceil(total / PAGE_SIZE)}</span>
              <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">Próxima →</button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
