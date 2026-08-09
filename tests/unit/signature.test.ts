// Checks do gate HMAC dos webhooks. Este e o unico controle que separa um
// payload legitimo do Zernio de qualquer POST anonimo na internet — as functions
// sobem com verify_jwt: false de proposito. Se ele afrouxar, qualquer um escreve
// no CRM.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  hmacSha256,
  macToBase64,
  macToHex,
  signatureMatches,
  verifyWebhookSignature,
} from '../../supabase/functions/_shared/signature.ts';

const SECRET = 'segredo-do-webhook';
const BODY = JSON.stringify({ event: 'message.received', data: { id: 'abc' } });

test('assinatura correta em hex passa', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, macToHex(mac)), true);
});

test('assinatura correta em base64 passa', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, macToBase64(mac)), true);
});

test('prefixo sha256= é aceito nos dois formatos', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, `sha256=${macToHex(mac)}`), true);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, `sha256=${macToBase64(mac)}`), true);
});

test('segredo errado não passa', async () => {
  const mac = await hmacSha256('outro-segredo', BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, macToHex(mac)), false);
});

test('corpo alterado depois de assinado não passa', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  const adulterado = JSON.stringify({ event: 'message.received', data: { id: 'HACK' } });
  assert.equal(await verifyWebhookSignature(SECRET, adulterado, macToHex(mac)), false);
});

test('um byte a menos no corpo já invalida', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY.slice(0, -1), macToHex(mac)), false);
});

// Falhar fechado: sem header ou sem segredo, NUNCA passa. Um `return true` por
// omissao aqui abriria o endpoint inteiro.
test('header ausente ou vazio não passa', async () => {
  assert.equal(await verifyWebhookSignature(SECRET, BODY, ''), false);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, null), false);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, undefined), false);
});

test('segredo ausente não passa, mesmo com header bem formado', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  assert.equal(await verifyWebhookSignature('', BODY, macToHex(mac)), false);
  assert.equal(await verifyWebhookSignature(null, BODY, macToHex(mac)), false);
});

test('assinatura de tamanho diferente é rejeitada sem comparar', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  assert.equal(signatureMatches(macToHex(mac).slice(0, 10), mac), false);
  assert.equal(signatureMatches(macToHex(mac) + 'ff', mac), false);
});

test('prefixo correto seguido de lixo não passa (sem match parcial)', async () => {
  const mac = await hmacSha256(SECRET, BODY);
  const hex = macToHex(mac);
  const quaseCerto = hex.slice(0, hex.length - 2) + (hex.endsWith('00') ? '11' : '00');
  assert.equal(signatureMatches(quaseCerto, mac), false);
});

test('hex é minúsculo e tem 64 caracteres (SHA-256)', async () => {
  const hex = macToHex(await hmacSha256(SECRET, BODY));
  assert.match(hex, /^[0-9a-f]{64}$/);
});
