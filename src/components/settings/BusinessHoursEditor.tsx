import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface DaySlot {
  enabled: boolean;
  start: string;
  end: string;
}

export type BusinessHours = Record<DayKey, DaySlot>;

const DAY_ORDER: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
];

const DEFAULT_HOURS: BusinessHours = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: false, start: '09:00', end: '13:00' },
  sun: { enabled: false, start: '09:00', end: '13:00' },
};

const DEFAULT_OFF_MSG = 'Olá! Nosso atendimento humano está fora do horário. Responderemos assim que possível.';

function mergeHours(stored: unknown): BusinessHours {
  if (!stored || typeof stored !== 'object') return DEFAULT_HOURS;
  const source = stored as Partial<BusinessHours>;
  const merged = { ...DEFAULT_HOURS };
  for (const { key } of DAY_ORDER) {
    const slot = source[key];
    if (slot && typeof slot === 'object') {
      merged[key] = {
        enabled: Boolean((slot as DaySlot).enabled),
        start: (slot as DaySlot).start || DEFAULT_HOURS[key].start,
        end: (slot as DaySlot).end || DEFAULT_HOURS[key].end,
      };
    }
  }
  return merged;
}

export interface BusinessHoursRow {
  business_hours: unknown;
  out_of_hours_message: string | null;
}

interface BusinessHoursEditorProps {
  title: string;
  description: string;
  /** Quando true, mostra um toggle "horário próprio" — desligado = herda o
   * nível acima (usuário herda do setor, setor herda do padrão global) e
   * salva null nas duas colunas em vez de um valor. */
  nullable?: boolean;
  inheritLabel?: string;
  load: () => Promise<BusinessHoursRow | null>;
  save: (patch: { business_hours: BusinessHours | null; out_of_hours_message: string | null }) => Promise<{ error?: string }>;
}

export function BusinessHoursEditor({
  title,
  description,
  nullable = false,
  inheritLabel = 'Usar o horário padrão',
  load,
  save,
}: BusinessHoursEditorProps) {
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [offHoursMsg, setOffHoursMsg] = useState(DEFAULT_OFF_MSG);
  const [overriding, setOverriding] = useState(!nullable);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().then((row) => {
      if (cancelled) return;
      const hasOverride = Boolean(row?.business_hours || row?.out_of_hours_message);
      setHours(mergeHours(row?.business_hours));
      if (row?.out_of_hours_message) setOffHoursMsg(row.out_of_hours_message);
      if (nullable) setOverriding(hasOverride);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDay = (key: DayKey, patch: Partial<DaySlot>) => {
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const patch = nullable && !overriding
      ? { business_hours: null, out_of_hours_message: null }
      : { business_hours: hours, out_of_hours_message: offHoursMsg || null };
    const { error } = await save(patch);
    setSaving(false);
    if (error) {
      toast.error('Falha ao salvar', { description: error });
      return;
    }
    toast.success('Horários salvos.');
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">{description}</p>
      </header>

      {nullable && (
        <label className="flex items-center gap-3 rounded-lg border border-[rgba(59,130,246,0.15)] bg-white/[0.02] px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={overriding}
            onChange={(e) => setOverriding(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />
          <span className="text-xs font-medium text-[var(--color-text-primary)]">
            {overriding ? 'Horário próprio (sobrescreve o padrão acima)' : inheritLabel}
          </span>
        </label>
      )}

      {(!nullable || overriding) && (
        <>
          <div className="space-y-2">
            {DAY_ORDER.map(({ key, label }) => (
              <div
                key={key}
                className="grid grid-cols-[auto_90px_1fr_1fr] items-center gap-2 p-2.5 rounded-lg border border-[rgba(59,130,246,0.1)] bg-white/[0.02]"
              >
                <input
                  type="checkbox"
                  checked={hours[key].enabled}
                  onChange={(e) => updateDay(key, { enabled: e.target.checked })}
                  disabled={saving}
                  className="accent-[var(--accent-primary)] h-4 w-4"
                />
                <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
                <Input
                  type="time"
                  value={hours[key].start}
                  onChange={(e) => updateDay(key, { start: e.target.value })}
                  disabled={saving || !hours[key].enabled}
                />
                <Input
                  type="time"
                  value={hours[key].end}
                  onChange={(e) => updateDay(key, { end: e.target.value })}
                  disabled={saving || !hours[key].enabled}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`off_msg_${title}`}>Mensagem fora do horário</Label>
            <textarea
              id={`off_msg_${title}`}
              value={offHoursMsg}
              onChange={(e) => setOffHoursMsg(e.target.value)}
              rows={2}
              disabled={saving}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)] focus:bg-white/[0.06]"
            />
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (<><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>) : (<>Salvar horário</>)}
        </Button>
      </div>
    </form>
  );
}
