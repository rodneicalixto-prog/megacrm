// Checks do envio de midia pelo operador na rota Evolution — o caminho que nao
// existia: `send-operator-media` so falava Zernio, entao anexar imagem ou
// arquivo falhava numa instalacao Evolution.

import { beforeEach, expect, test, vi } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase.ts';

const db = new FakeSupabase();
const credentials: Record<string, string | null> = {};
const evolutionCalls: Array<{ url: string; body: unknown }> = [];
let evolutionOk = true;

vi.mock('../../supabase/functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => db,
  getAuthAdminClient: () => db,
}));
vi.mock('../../supabase/functions/_shared/credentials.ts', () => ({
  getCredential: async (key: string) => credentials[key] ?? null,
  setCredential: async () => {},
}));
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  requireCaller: async () => ({ userId: 'op-1', email: 'op@ex.com', role: 'operator' }),
  requireAdmin: async () => ({ userId: 'op-1', email: 'op@ex.com', role: 'admin' }),
  requireServiceRole: async () => {},
  AuthError: class AuthError extends Error { status = 401; },
}));

const { handleOperatorMedia } = await import(
  '../../supabase/functions/send-operator-media/index.ts'
);

function form(file: File, over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set('conversation_id', 'conv1');
  fd.set('content', 'olha o orçamento');
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  fd.set('file', file);
  return new Request('https://fake.supabase.co/functions/v1/send-operator-media', {
    method: 'POST',
    body: fd,
  });
}

const png = () => new File([new Uint8Array([1, 2, 3])], 'orcamento.png', { type: 'image/png' });

beforeEach(() => {
  db.tables = {};
  db.storageFiles = [];
  db.storageShouldFail = false;
  evolutionCalls.length = 0;
  evolutionOk = true;
  credentials.evolution_server_url = 'https://evo.example.com';
  credentials.evolution_api_key = 'apikey';
  credentials.evolution_instance = 'pricall';

  db.seed('contacts', [{ id: 'c1', phone: '+5511999998888' }]);
  db.seed('conversations', [
    { id: 'conv1', contact_id: 'c1', channel: 'evolution', zernio_conversation_id: null },
  ]);

  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    evolutionCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(evolutionOk ? { key: { id: 'EVO1' } } : { error: 'nope' }), {
      status: evolutionOk ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

test('imagem sobe ao bucket e é enviada pela Evolution', async () => {
  const res = await handleOperatorMedia(form(png()));
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ sent_via: 'evolution' });
  expect(db.storageFiles).toHaveLength(1);
  expect(db.storageFiles[0]).toContain('whatsapp-hub-outbound-media/conv1/');
});

test('a Evolution recebe a URL pública, não o arquivo', async () => {
  await handleOperatorMedia(form(png()));
  const chamada = evolutionCalls.at(-1)!;

  expect(chamada.url).toContain('/message/sendMedia/pricall');
  expect(chamada.body).toMatchObject({
    number: '5511999998888',
    mediatype: 'image',
    caption: 'olha o orçamento',
  });
  expect(String((chamada.body as { media: string }).media)).toContain(
    '/storage/v1/object/public/whatsapp-hub-outbound-media/',
  );
});

test('a mensagem entra na thread com a URL, para o CRM renderizar', async () => {
  await handleOperatorMedia(form(png()));
  const msg = db.rows('messages')[0];

  expect(msg).toMatchObject({
    direction: 'outbound',
    sender_type: 'operator',
    content_type: 'image',
    content: 'olha o orçamento',
    meta_status: 'sent',
    zernio_message_id: 'evolution:EVO1',
  });
  expect(String(msg.media_url)).toContain('whatsapp-hub-outbound-media');
});

test('enviar assume a conversa: humano no comando, IA pausada', async () => {
  await handleOperatorMedia(form(png()));
  expect(db.rows('conversations')[0]).toMatchObject({
    status: 'human_active',
    ai_paused: true,
    assigned_to: 'op-1',
  });
});

test('áudio vai pela rota de voz, não por sendMedia', async () => {
  const ogg = new File([new Uint8Array([9])], 'audio.ogg', { type: 'audio/ogg' });
  await handleOperatorMedia(form(ogg, { voice_note: 'true' }));
  expect(evolutionCalls.at(-1)!.url).toContain('/message/sendWhatsAppAudio/pricall');
});

test('vídeo sobe ao bucket e é enviado pela Evolution como video', async () => {
  const mp4 = new File([new Uint8Array([4, 5, 6])], 'demo.mp4', { type: 'video/mp4' });
  await handleOperatorMedia(form(mp4));
  const chamada = evolutionCalls.at(-1)!;

  expect(chamada.url).toContain('/message/sendMedia/pricall');
  expect(chamada.body).toMatchObject({
    number: '5511999998888',
    mediatype: 'video',
    caption: 'olha o orçamento',
  });
  expect(String((chamada.body as { media: string }).media)).toContain('demo.mp4');
  expect(db.rows('messages')[0]).toMatchObject({
    content_type: 'video',
    media_url: expect.stringContaining('whatsapp-hub-outbound-media'),
  });
});

test('documento sem tipo conhecido cai em document', async () => {
  const bin = new File([new Uint8Array([7])], 'contrato.pdf', { type: 'application/pdf' });
  await handleOperatorMedia(form(bin));
  expect(evolutionCalls.at(-1)!.body).toMatchObject({ mediatype: 'document' });
});

// Se o envio falha depois do upload, o arquivo ficaria no bucket para sempre,
// sem mensagem que o referencie.
test('falha no envio remove o arquivo do bucket e não grava mensagem', async () => {
  evolutionOk = false;
  const res = await handleOperatorMedia(form(png()));

  expect(res.status).toBe(502);
  expect(db.storageFiles).toHaveLength(0);
  expect(db.rows('messages')).toHaveLength(0);
});

test('falha no upload não chega a chamar a Evolution', async () => {
  db.storageShouldFail = true;
  const res = await handleOperatorMedia(form(png()));

  expect(res.status).toBe(502);
  expect(evolutionCalls).toHaveLength(0);
  expect(db.rows('messages')).toHaveLength(0);
});

test('contato sem telefone é recusado antes de subir arquivo', async () => {
  db.seed('contacts', [{ id: 'c1', phone: null }]);
  const res = await handleOperatorMedia(form(png()));

  expect(res.status).toBe(400);
  expect(db.storageFiles).toHaveLength(0);
});

test('conversa inexistente devolve 404', async () => {
  db.seed('conversations', []);
  const res = await handleOperatorMedia(form(png()));
  expect(res.status).toBe(404);
});

