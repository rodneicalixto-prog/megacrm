// Check do parser inbound da Evolution API — a rota não-oficial do projeto.
// parseInboundWebhook é puro (sem I/O, sem API do Deno) por contrato do
// types.ts, então roda no node:test da stdlib, sem runner extra.
//
//   npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionProvider } from '../../supabase/functions/_shared/whatsapp/evolution-provider.ts';

const provider = new EvolutionProvider('https://evo.example.com/', 'apikey123', 'minha-instancia');

test('mensagem de texto 1:1 vira NormalizedInbound', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    instance: 'minha-instancia',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'ABC123' },
      pushName: 'Rodnei',
      message: { conversation: 'Oi, quero saber o preço' },
      messageType: 'conversation',
      messageTimestamp: 1754668800,
    },
  });

  assert.equal(got?.from, '+5511999998888');
  assert.equal(got?.text, 'Oi, quero saber o preço');
  assert.equal(got?.messageId, 'ABC123');
  assert.equal(got?.isFromMe, false);
  assert.equal(got?.contentType, 'text');
  assert.equal(got?.senderName, 'Rodnei');
  assert.equal(got?.timestamp, '2025-08-08T16:00:00.000Z'); // epoch 1754668800
});

test('extendedTextMessage também é texto', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'X1' },
      message: { extendedTextMessage: { text: 'com link https://a.com' } },
    },
  });
  assert.equal(got?.text, 'com link https://a.com');
  assert.equal(got?.contentType, 'text');
});

test('mensagem de grupo é ignorada (senão a IA responderia no privado de quem falou)', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '120363000000000000@g.us',
        participant: '5511977776666@s.whatsapp.net',
        fromMe: false,
        id: 'G1',
      },
      message: { conversation: 'oi grupo' },
    },
  });
  assert.equal(got, null);
});

test('status/broadcast é ignorado', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: 'status@broadcast', fromMe: false, id: 'B9' },
      message: { conversation: 'status' },
    },
  });
  assert.equal(got, null);
});

test('imagem com S3 configurado prefere mediaUrl armazenada', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'IMG1' },
      message: {
        mediaUrl: 'https://files.exemplo.com/evolution/img.jpg',
        imageMessage: { caption: 'olha isso', url: 'https://mmg.whatsapp.net/cru' },
      },
    },
  });
  assert.equal(got?.contentType, 'image');
  assert.equal(got?.text, 'olha isso');
  assert.equal(got?.mediaUrl, 'https://files.exemplo.com/evolution/img.jpg');
});

test('echo da própria conta é marcado isFromMe (o core descarta)', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'E1' },
      message: { conversation: 'resposta do bot' },
    },
  });
  assert.equal(got?.isFromMe, true);
});

test('fromMe como string ou 1 também conta como echo', () => {
  for (const fromMe of ['true', 1]) {
    const got = provider.parseInboundWebhook({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe, id: `E-${fromMe}` },
        message: { conversation: 'resposta do dono pelo celular' },
      },
    });
    assert.equal(got?.isFromMe, true, String(fromMe));
  }
});

test('data em array (upsert em lote) processa a primeira mensagem', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: [
      {
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'B1' },
        message: { conversation: 'primeira' },
      },
    ],
  });
  assert.equal(got?.messageId, 'B1');
  assert.equal(got?.text, 'primeira');
});

test('eventos que não são mensagem são ignorados', () => {
  for (const event of ['connection.update', 'presence.update', 'contacts.upsert']) {
    assert.equal(provider.parseInboundWebhook({ event, data: { state: 'open' } }), null, event);
  }
});

test('payload sem id de mensagem é ignorado em vez de virar lixo', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: { key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false } },
  });
  assert.equal(got, null);
});

test('JID que não é telefone (broadcast/status) é descartado', () => {
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' },
      message: { conversation: 'status' },
    },
  });
  assert.equal(got, null);
});

test('Evolution nunca entrega referral CTWA', () => {
  assert.equal(provider.extractReferral({ event: 'messages.upsert', data: {} }), null);
});
