// Check do parser inbound da Evolution API — a rota não-oficial do projeto.
// parseInboundWebhook é puro (sem I/O, sem API do Deno) por contrato do
// types.ts, então roda no node:test da stdlib, sem runner extra.
//
//   npm run test:unit

import { test } from 'vitest';
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

test('link com preview (jpegThumbnail embutido) vira contentType image', () => {
  // Facebook/Instagram/YouTube etc: o Baileys manda a miniatura do link
  // embutida em base64 junto do texto — sem tratar isso a mensagem chegava
  // como texto puro, sem a "foto" que o WhatsApp mostra ao lado do link.
  const got = provider.parseInboundWebhook({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'X2' },
      message: {
        extendedTextMessage: {
          text: 'https://www.facebook.com/share/r/abc123',
          jpegThumbnail: 'ZmFrZS1qcGVn', // base64 arbitrário só pra existir
        },
      },
    },
  });
  assert.equal(got?.text, 'https://www.facebook.com/share/r/abc123');
  assert.equal(got?.contentType, 'image');
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

test('baixa e decodifica mídia inbound pela rota oficial da Evolution', async () => {
  const originalFetch = globalThis.fetch;
  let receivedBody: unknown;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://evo.example.com/chat/getBase64FromMediaMessage/minha-instancia');
    receivedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      base64: btoa('audio-real'),
      mimetype: 'audio/ogg; codecs=opus',
      fileName: 'mensagem.ogg',
    }));
  }) as typeof fetch;

  const payload = {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'AUD1' },
      message: { audioMessage: { directPath: '/encrypted', mediaKey: { 0: 1 } } },
    },
  };

  try {
    const media = await provider.downloadInboundMedia(payload);
    assert.deepEqual(Array.from(media?.bytes ?? []), Array.from(new TextEncoder().encode('audio-real')));
    assert.equal(media?.mime, 'audio/ogg; codecs=opus');
    assert.equal(media?.fileName, 'mensagem.ogg');
    assert.deepEqual(receivedBody, { message: payload.data });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('miniatura de link é decodificada direto do payload, sem chamar a Evolution', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => { fetchCalled = true; throw new Error('não deveria chamar a API'); }) as typeof fetch;

  const payload = {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'X2' },
      message: {
        extendedTextMessage: {
          text: 'https://www.facebook.com/share/r/abc123',
          jpegThumbnail: btoa('fake-jpeg-bytes'),
        },
      },
    },
  };

  try {
    const media = await provider.downloadInboundMedia(payload);
    assert.equal(fetchCalled, false);
    assert.equal(media?.mime, 'image/jpeg');
    assert.deepEqual(Array.from(media?.bytes ?? []), Array.from(new TextEncoder().encode('fake-jpeg-bytes')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('áudio usa sendMedia como fallback quando sendWhatsAppAudio falha', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
    if (String(input).includes('/message/sendWhatsAppAudio/')) {
      return new Response(JSON.stringify({ error: 'rota indisponível' }), { status: 404 });
    }
    return new Response(JSON.stringify({ key: { id: 'AUDIO-FALLBACK-1' } }), { status: 200 });
  }) as typeof fetch;

  try {
    const got = await provider.sendMessage('+55 11 99999-8888', '', {
      mediaUrl: 'https://cdn.exemplo.com/audio.ogg',
      mediaType: 'audio',
    });

    assert.equal(got.ok, true);
    assert.equal(got.messageId, 'AUDIO-FALLBACK-1');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://evo.example.com/message/sendWhatsAppAudio/minha-instancia');
    assert.equal(calls[1].url, 'https://evo.example.com/message/sendMedia/minha-instancia');
    assert.deepEqual(calls[1].body, {
      number: '5511999998888',
      mediatype: 'audio',
      media: 'https://cdn.exemplo.com/audio.ogg',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('texto citado envia a chave correta para a Evolution', async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ key: { id: 'REPLY-1' } }), { status: 200 });
  }) as typeof fetch;
  try {
    const got = await provider.sendMessage('+55 11 99999-8888', 'resposta', {
      quotedMessageId: 'ORIGINAL-1',
      quotedRemoteJid: '5511999998888@s.whatsapp.net',
      quotedFromMe: false,
    });
    assert.equal(got.ok, true);
    assert.deepEqual(body.quoted, { key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'ORIGINAL-1' } });
  } finally { globalThis.fetch = originalFetch; }
});

test('presença e reação usam os endpoints oficiais', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await provider.sendPresence('+55 11 99999-8888', 'composing');
    await provider.react('+55 11 99999-8888', 'MSG-1', '👍', true);
    assert.equal(calls[0].url, 'https://evo.example.com/chat/sendPresence/minha-instancia');
    assert.deepEqual(calls[0].body, { number: '5511999998888', presence: 'composing', delay: 1200 });
    assert.equal(calls[1].url, 'https://evo.example.com/message/sendReaction/minha-instancia');
    assert.deepEqual(calls[1].body, { key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'MSG-1' }, reaction: '👍' });
  } finally { globalThis.fetch = originalFetch; }
});

test('nota de voz não cai no fallback de arquivo de áudio', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response('{}', { status: 500 }); }) as typeof fetch;
  try {
    const got = await provider.sendMessage('5511999998888', '', { mediaUrl: 'https://cdn.exemplo.com/voz.webm', mediaType: 'audio', voiceNote: true });
    assert.equal(got.ok, false);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});