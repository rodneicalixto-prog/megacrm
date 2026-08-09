// Variaveis de horario que o prompt do agente recebe: que horas sao agora no
// fuso da operacao, se esta dentro do expediente, e a mensagem de fora-do-
// horario ja preenchida.
//
// Nao ha gate no codigo — quem decide usar isso e o prompt. Por isso os valores
// precisam estar certos: um `dentro_do_horario` errado faz o agente atender de
// madrugada ou recusar atendimento no meio da tarde.
//
// `now` e injetavel para o teste poder fixar o instante; em producao ninguem
// passa e vale o relogio.

export type DaySlot = { enabled?: boolean; start?: string; end?: string };

export const DAY_LABELS: Record<string, string> = {
  mon: 'segunda', tue: 'terça', wed: 'quarta', thu: 'quinta',
  fri: 'sexta', sat: 'sábado', sun: 'domingo',
};
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND = ['sat', 'sun'];
const SHORT_TO_KEY: Record<string, string> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
};

export function nowInTz(tz: string, now: Date = new Date()): {
  key: string;
  hhmm: string;
  label: string;
} {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
  } catch {
    // Fuso invalido nao pode derrubar o atendimento: cai no fuso do runtime.
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
  }
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  // hour12:false devolve 24 para a meia-noite em alguns ambientes.
  const rawHour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const hh = rawHour === '24' ? '00' : rawHour;
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const key = SHORT_TO_KEY[wd] ?? 'mon';
  return { key, hhmm: `${hh}:${mm}`, label: DAY_LABELS[key] };
}

export function slotOf(bh: unknown, key: string): DaySlot {
  return (bh && typeof bh === 'object' ? (bh as Record<string, DaySlot>)[key] : null) ?? {};
}

export function buildScheduleVars(
  tz: string,
  businessHours: unknown,
  outMsg: string | null,
  now: Date = new Date(),
): Record<string, string> {
  const { key, hhmm, label } = nowInTz(tz, now);
  const today = slotOf(businessHours, key);
  // Comparacao lexicografica funciona porque HH:MM e zero-padded.
  const within =
    Boolean(today.enabled) &&
    typeof today.start === 'string' && typeof today.end === 'string' &&
    today.start <= hhmm && hhmm <= today.end;

  const wdOn = WEEKDAYS.filter((k) => slotOf(businessHours, k).enabled);
  const weOn = WEEKEND.filter((k) => slotOf(businessHours, k).enabled);
  const wkFirst = wdOn.length ? slotOf(businessHours, wdOn[0]) : {};
  const weFirst = weOn.length ? slotOf(businessHours, weOn[0]) : {};

  const filled = (outMsg ?? '')
    .replace(/\{dia_inicial\}/g, wdOn.length ? DAY_LABELS[wdOn[0]] : '')
    .replace(/\{dia_final\}/g, wdOn.length ? DAY_LABELS[wdOn[wdOn.length - 1]] : '')
    .replace(/\{horario_inicial_week\}/g, wkFirst.start ?? '')
    .replace(/\{horario_final_week\}/g, wkFirst.end ?? '')
    .replace(/\{final_de_semana\}/g, weOn.map((k) => DAY_LABELS[k]).join(' e '))
    .replace(/\{horario_inicial_weekend\}/g, weFirst.start ?? '')
    .replace(/\{horario_final_weekend\}/g, weFirst.end ?? '');

  const readable = [
    wdOn.length ? `${DAY_LABELS[wdOn[0]]} a ${DAY_LABELS[wdOn[wdOn.length - 1]]} ${wkFirst.start}–${wkFirst.end}` : '',
    weOn.length ? `${weOn.map((k) => DAY_LABELS[k]).join(' e ')} ${weFirst.start}–${weFirst.end}` : '',
  ].filter(Boolean).join('; ');

  return {
    agora: `${label}, ${hhmm}`,
    dentro_do_horario: within ? 'sim' : 'não',
    horario_atendimento: readable,
    mensagem_fora_horario: filled.trim(),
  };
}
