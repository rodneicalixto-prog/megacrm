// Checks das variaveis de horario que vao para o prompt do agente. Nao existe
// gate no codigo — o prompt e quem decide. Entao um `dentro_do_horario` errado
// faz o agente atender de madrugada ou recusar no meio da tarde, sem nada no
// caminho para pegar isso.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildScheduleVars, nowInTz, slotOf } from '../../supabase/functions/_shared/business-hours.ts';

const TZ = 'America/Sao_Paulo';
const COMERCIAL = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: true, start: '09:00', end: '13:00' },
  sun: { enabled: false },
};

// 2026-08-10 e uma segunda-feira. 15:00Z = 12:00 em Sao Paulo (UTC-3).
const SEG_MEIO_DIA = new Date('2026-08-10T15:00:00Z');
const SEG_MADRUGADA = new Date('2026-08-10T06:00:00Z'); // 03:00 local
const DOM_MEIO_DIA = new Date('2026-08-09T15:00:00Z');

// --------------------------------------------------------------- nowInTz

test('converte para o fuso pedido, não para o do servidor', () => {
  const got = nowInTz(TZ, SEG_MEIO_DIA);
  assert.equal(got.key, 'mon');
  assert.equal(got.hhmm, '12:00');
  assert.equal(got.label, 'segunda');
});

test('fuso inválido não derruba o atendimento', () => {
  const got = nowInTz('Fuso/Inexistente', SEG_MEIO_DIA);
  assert.ok(/^\d{2}:\d{2}$/.test(got.hhmm));
  assert.ok(got.label);
});

test('meia-noite sai como 00:00, não 24:00', () => {
  // 03:00Z = 00:00 em Sao Paulo.
  assert.equal(nowInTz(TZ, new Date('2026-08-10T03:00:00Z')).hhmm, '00:00');
});

// ---------------------------------------------------------------- slotOf

test('dia ausente ou config inválida devolve slot vazio em vez de quebrar', () => {
  assert.deepEqual(slotOf(COMERCIAL, 'xxx'), {});
  assert.deepEqual(slotOf(null, 'mon'), {});
  assert.deepEqual(slotOf('texto', 'mon'), {});
});

// ------------------------------------------------------ dentro do horário

test('meio-dia de segunda está dentro', () => {
  const got = buildScheduleVars(TZ, COMERCIAL, null, SEG_MEIO_DIA);
  assert.equal(got.dentro_do_horario, 'sim');
  assert.equal(got.agora, 'segunda, 12:00');
});

test('madrugada de segunda está fora', () => {
  assert.equal(buildScheduleVars(TZ, COMERCIAL, null, SEG_MADRUGADA).dentro_do_horario, 'não');
});

test('dia desabilitado está fora mesmo em horário comercial', () => {
  assert.equal(buildScheduleVars(TZ, COMERCIAL, null, DOM_MEIO_DIA).dentro_do_horario, 'não');
});

test('os limites são inclusivos nas duas pontas', () => {
  const abertura = new Date('2026-08-10T12:00:00Z'); // 09:00 local
  const fechamento = new Date('2026-08-10T21:00:00Z'); // 18:00 local
  assert.equal(buildScheduleVars(TZ, COMERCIAL, null, abertura).dentro_do_horario, 'sim');
  assert.equal(buildScheduleVars(TZ, COMERCIAL, null, fechamento).dentro_do_horario, 'sim');
});

test('um minuto depois do fechamento já está fora', () => {
  const got = buildScheduleVars(TZ, COMERCIAL, null, new Date('2026-08-10T21:01:00Z'));
  assert.equal(got.dentro_do_horario, 'não');
});

test('sem configuração de horário nada está dentro', () => {
  assert.equal(buildScheduleVars(TZ, null, null, SEG_MEIO_DIA).dentro_do_horario, 'não');
  assert.equal(buildScheduleVars(TZ, {}, null, SEG_MEIO_DIA).dentro_do_horario, 'não');
});

test('dia habilitado mas sem start/end não conta como dentro', () => {
  const bh = { mon: { enabled: true } };
  assert.equal(buildScheduleVars(TZ, bh, null, SEG_MEIO_DIA).dentro_do_horario, 'não');
});

// ------------------------------------------- mensagem de fora do horário

test('placeholders da mensagem são preenchidos com a configuração real', () => {
  const msg =
    'Atendemos de {dia_inicial} a {dia_final}, das {horario_inicial_week} às {horario_final_week}. ' +
    '{final_de_semana}: {horario_inicial_weekend} às {horario_final_weekend}.';
  const got = buildScheduleVars(TZ, COMERCIAL, msg, SEG_MADRUGADA);
  assert.equal(
    got.mensagem_fora_horario,
    'Atendemos de segunda a sexta, das 09:00 às 18:00. sábado: 09:00 às 13:00.',
  );
});

test('sem mensagem configurada o campo sai vazio', () => {
  assert.equal(buildScheduleVars(TZ, COMERCIAL, null, SEG_MEIO_DIA).mensagem_fora_horario, '');
});

test('horário legível cobre semana e fim de semana', () => {
  const got = buildScheduleVars(TZ, COMERCIAL, null, SEG_MEIO_DIA);
  assert.equal(got.horario_atendimento, 'segunda a sexta 09:00–18:00; sábado 09:00–13:00');
});

test('só dias úteis habilitados não inventa fim de semana', () => {
  const bh = { ...COMERCIAL, sat: { enabled: false }, sun: { enabled: false } };
  const got = buildScheduleVars(TZ, bh, null, SEG_MEIO_DIA);
  assert.equal(got.horario_atendimento, 'segunda a sexta 09:00–18:00');
});
