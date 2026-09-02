// Checks do whatsapp-inbound com o handler inteiro, do POST ate o estado no
// banco. E o unico ponto por onde mensagem de fora entra no CRM, e sobe com
// verify_jwt desligado: o que separa um payload legitimo de qualquer POST
// anonimo e a assinatura (rota Zernio) ou a resolucao de credencial.

import { beforeEach, expect, test, vi } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase.ts';
import { hmacSha256, macToHex } from '../../supabase/functions/_shared/signature.ts';

const db = new FakeSupabase();
const credentials: Record<string, string | null> = {};

vi.mock('../../supabase/functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => db,
  getAuthAdminClient: () => db,
}));
vi.mock('../../supabase/functions/_shared/credentials.ts', () => ({
  getCredential: async (key: string) => credentials[key] ?? null,
  setCredential: async () => {},
}));

const { handleInbound } = await import('../../supabase/functions/whatsapp-inbound/index.ts');

const EVOLUTION_SECRET = 'segredo-evolution';
const EVOLUTION_URL =
  'https://fake.supabase.co/functions/v1/whatsapp-inbound?provider=evolution&token=' +
  EVOLUTION_SECRET;

function upsert(body: Record<string, unknown>) {
  return { event: 'messages.upsert', instance: 'pricall', data: body };
}

function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

function msg(over: Record<string, unknown> = {}) {
  return upsert({
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'MSG1', ...(over.key ?? {}) },
    pushName: 'Cliente',
    message: { conversation: 'Olá, quero saber o preço' },
    messageTimestamp: 1786200000,
    ...over,
  });
}

const DEPT = 'dept-geral';

beforeEach(() => {
  db.tables = {};
  db.rpcCalls = [];
  db.storageFiles = [];
  // O número que recebe define o departamento. Sem departamento padrão a
  // mensagem é recusada de propósito — melhor que aterrissar no lugar errado.
  db.seed('departments', [{ id: DEPT, name: 'Geral', is_default: true }]);
  db.rpcResults = { attribute_inbound_lead: { data: { method: 'whatsapp_direto' }, error: null } };
  for (const k of Object.keys(credentials)) delete credentials[k];
  credentials.evolution_server_url = 'https://evo.example.com';
  credentials.evolution_api_key = 'apikey';
  credentials.evolution_instance = 'pricall';
  credentials.evolution_webhook_secret = EVOLUTION_SECRET;
});

// ------------------------------------------------------------- método

test('GET é recusado', async () => {
  const res = await handleInbound(new Request(EVOLUTION_URL, { method: 'GET' }));
  expect(res.status).toBe(405);
});

test('JSON inválido é recusado sem tocar no banco', async () => {
  const res = await handleInbound(
    new Request(EVOLUTION_URL, { method: 'POST', body: 'não é json' }),
  );
  expect(res.status).toBe(400);
  expect(db.rows('contacts')).toHaveLength(0);
});
test('Evolution recusa payload sem segredo de webhook', async () => {
  const url = 'https://fake.supabase.co/functions/v1/whatsapp-inbound?provider=evolution';
  const res = await handleInbound(post(url, msg()));
  expect(res.status).toBe(401);
  expect(db.rows('contacts')).toHaveLength(0);
});

test('Evolution recusa segredo de webhook incorreto', async () => {
  const url =
    'https://fake.supabase.co/functions/v1/whatsapp-inbound?provider=evolution&token=incorreto';
  const res = await handleInbound(post(url, msg()));
  expect(res.status).toBe(401);
  expect(db.rows('contacts')).toHaveLength(0);
});

// --------------------------------------------------- credencial ausente

test('sem provedor configurado não engole a mensagem em silêncio', async () => {
  delete credentials.evolution_api_key;
  const res = await handleInbound(post(EVOLUTION_URL, msg()));
  expect(res.status).toBe(500);
  expect(await res.json()).toMatchObject({ error: 'nenhum provedor configurado' });
});

// ------------------------------------------------------ caminho feliz

test('mensagem nova cria contato, conversa e mensagem no inbox', async () => {
  const res = await handleInbound(post(EVOLUTION_URL, msg()));
  expect(res.status).toBe(200);

  const contato = db.rows('contacts')[0];
  expect(contato).toMatchObject({ phone: '+5511999998888', name: 'Cliente', source: 'whatsapp' });

  const conversa = db.rows('conversations')[0];
  expect(conversa).toMatchObject({ channel: 'evolution', status: 'ai_active', department_id: DEPT });

  const mensagem = db.rows('messages')[0];
  expect(mensagem).toMatchObject({
    direction: 'inbound',
    sender_type: 'contact',
    content: 'Olá, quero saber o preço',
    zernio_message_id: 'evolution:MSG1',
  });
});

test('áudio inbound é materializado no Storage antes de entrar na thread', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    base64: btoa('ogg-real'),
    mimetype: 'audio/ogg',
    fileName: 'audio.ogg',
  }))) as typeof fetch;

  try {
    const res = await handleInbound(post(EVOLUTION_URL, msg({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'AUD2' },
      message: { audioMessage: { directPath: '/arquivo-criptografado', mediaKey: { 0: 1 } } },
    })));
    expect(res.status).toBe(200);
    expect(db.rows('messages')[0]).toMatchObject({
      content_type: 'audio',
      media_url: 'https://fake.supabase.co/storage/v1/object/public/whatsapp-hub-outbound-media/inbound/AUD2/audio.ogg',
    });
    expect(db.storageFiles).toContain('whatsapp-hub-outbound-media/inbound/AUD2/audio.ogg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('contato já existente é reaproveitado em vez de duplicado', async () => {
  db.seed('contacts', [{ id: 'c-existente', phone: '+5511999998888' }]);
  await handleInbound(post(EVOLUTION_URL, msg()));
  expect(db.rows('contacts')).toHaveLength(1);
  expect(db.rows('conversations')[0]).toMatchObject({ contact_id: 'c-existente' });
});

test('contato existente sem nome é identificado pelo pushName da Evolution', async () => {
  db.seed('contacts', [{ id: 'c-agenda', phone: '+5511999998888', name: null }]);

  await handleInbound(post(EVOLUTION_URL, msg({ pushName: 'Talita Marques' })));

  expect(db.rows('contacts')).toHaveLength(1);
  expect(db.rows('contacts')[0]).toMatchObject({
    id: 'c-agenda',
    phone: '+5511999998888',
    name: 'Talita Marques',
  });
});

test('pushName da Evolution não sobrescreve nome editado pelo operador', async () => {
  db.seed('contacts', [{ id: 'c-manual', phone: '+5511999998888', name: 'Talita Comercial' }]);

  await handleInbound(post(EVOLUTION_URL, msg({ pushName: 'Talita Marques' })));

  expect(db.rows('contacts')[0]).toMatchObject({ name: 'Talita Comercial' });
});

test('a atribuição é chamada com o telefone resolvido', async () => {
  await handleInbound(post(EVOLUTION_URL, msg()));
  const chamada = db.rpcCalls.find((c) => c.name === 'attribute_inbound_lead');
  expect(chamada?.args).toMatchObject({ p_text: 'Olá, quero saber o preço', p_provider: 'evolution' });
});

// ------------------------------------------------------- idempotência

test('a mesma mensagem entregue duas vezes só entra uma', async () => {
  await handleInbound(post(EVOLUTION_URL, msg()));
  const res = await handleInbound(post(EVOLUTION_URL, msg()));

  expect(await res.json()).toMatchObject({ deduped: true });
  expect(db.rows('messages')).toHaveLength(1);
  expect(db.rows('contacts')).toHaveLength(1);
});

test('sem departamento padrão a mensagem é recusada, não chutada', async () => {
  db.seed('departments', []);
  const res = await handleInbound(post(EVOLUTION_URL, msg()));

  expect(res.status).toBe(500);
  expect(db.rows('contacts')).toHaveLength(0);
});

test('instância global configurada usa o departamento padrão durante a transição', async () => {
  const res = await handleInbound(post(EVOLUTION_URL, msg()));

  expect(res.status).toBe(200);
  expect(db.rows('conversations')[0]).toMatchObject({ department_id: DEPT });
});

test('instância desconhecida continua bloqueada mesmo com departamento padrão', async () => {
  const res = await handleInbound(post(EVOLUTION_URL, { ...msg(), instance: 'desconhecida' }));

  expect(res.status).toBe(500);
  expect(await res.json()).toMatchObject({ error: 'instância não associada a departamento' });
  expect(db.rows('contacts')).toHaveLength(0);
});

test('a instância cadastrada manda a conversa para o departamento dela', async () => {
  db.seed('departments', [
    { id: DEPT, name: 'Geral', is_default: true },
    { id: 'dept-rh', name: 'Recursos Humanos', is_default: false },
  ]);
  db.seed('department_connections', [
    { department_id: 'dept-rh', instance: 'pricall', server_url: null, api_key_encrypted: null },
  ]);

  await handleInbound(post(EVOLUTION_URL, msg()));
  expect(db.rows('conversations')[0]).toMatchObject({ department_id: 'dept-rh' });
});

// ------------------------------------------------------------- grupos

test('mensagem de grupo é descartada — a IA não pode responder no privado', async () => {
  const res = await handleInbound(
    post(EVOLUTION_URL, msg({
      key: {
        remoteJid: '120363000000000000@g.us',
        participant: '5511977776666@s.whatsapp.net',
        fromMe: false,
        id: 'G1',
      },
    })),
  );
  expect(res.status).toBe(200);
  expect(db.rows('contacts')).toHaveLength(0);
  expect(db.rows('conversations')).toHaveLength(0);
});

test('status/broadcast é descartado', async () => {
  await handleInbound(
    post(EVOLUTION_URL, msg({ key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' } })),
  );
  expect(db.rows('contacts')).toHaveLength(0);
});

test('evento que não é mensagem é aceito e ignorado', async () => {
  const res = await handleInbound(
    post(EVOLUTION_URL, { event: 'connection.update', data: { state: 'open' } }),
  );
  expect(res.status).toBe(200);
  expect(db.rows('contacts')).toHaveLength(0);
});

// ------------------------------ resposta do dono pelo próprio celular

test('dono respondendo pelo celular pausa a IA daquela conversa', async () => {
  db.seed('contacts', [{ id: 'c1', phone: '+5511999998888' }]);
  db.seed('conversations', [{ id: 'conv1', contact_id: 'c1', department_id: DEPT, ai_paused: false, status: 'ai_active' }]);

  const res = await handleInbound(
    post(EVOLUTION_URL, msg({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'OWN1' },
      message: { conversation: 'Pode deixar que eu respondo' },
    })),
  );

  expect(await res.json()).toMatchObject({ owner_reply: true });
  expect(db.rows('conversations')[0]).toMatchObject({ ai_paused: true, status: 'human_active' });
});

test('a fala do dono é registrada na thread como do operador', async () => {
  db.seed('contacts', [{ id: 'c1', phone: '+5511999998888' }]);
  db.seed('conversations', [{ id: 'conv1', contact_id: 'c1', department_id: DEPT, ai_paused: false }]);

  await handleInbound(
    post(EVOLUTION_URL, msg({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'OWN2' },
      message: { conversation: 'já te retorno' },
    })),
  );

  expect(db.rows('messages')[0]).toMatchObject({
    direction: 'outbound',
    sender_type: 'operator',
    content: 'já te retorno',
    meta_status: 'sent',
  });
});

test('echo sem conversa não cria nada — não há o que pausar', async () => {
  const res = await handleInbound(
    post(EVOLUTION_URL, msg({
      key: { remoteJid: '5511900000000@s.whatsapp.net', fromMe: true, id: 'OWN3' },
    })),
  );
  expect(await res.json()).toMatchObject({ skipped: 'echo sem contato' });
  expect(db.rows('contacts')).toHaveLength(0);
  expect(db.rows('conversations')).toHaveLength(0);
});

// ------------------------------------------------- assinatura (Zernio)

const ZERNIO_URL = 'https://fake.supabase.co/functions/v1/whatsapp-inbound?provider=zernio';

test('rota Zernio recusa payload sem assinatura', async () => {
  credentials.zernio_webhook_secret = 'segredo';
  credentials.zernio_api_key = 'sk_zernio';
  const res = await handleInbound(post(ZERNIO_URL, msg()));
  expect(res.status).toBe(401);
});

test('rota Zernio recusa assinatura de outro segredo', async () => {
  credentials.zernio_webhook_secret = 'segredo';
  credentials.zernio_api_key = 'sk_zernio';
  const body = JSON.stringify(msg());
  const mac = await hmacSha256('segredo-errado', body);
  const res = await handleInbound(
    new Request(ZERNIO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zernio-Signature': macToHex(mac) },
      body,
    }),
  );
  expect(res.status).toBe(401);
});

// O header X-Zernio-Signature sozinho ja roteia para a rota oficial, mesmo sem
// ?provider= — entao ele nao pode virar um jeito de pular a verificacao.
test('header de assinatura presente força a verificação mesmo sem ?provider=', async () => {
  credentials.zernio_webhook_secret = 'segredo';
  const semProvider = 'https://fake.supabase.co/functions/v1/whatsapp-inbound';
  const res = await handleInbound(post(semProvider, msg(), { 'X-Zernio-Signature': 'lixo' }));
  expect(res.status).toBe(401);
});

// ------------------------------------- número por pessoa (modelo do RH)

test('número de uma pessoa já nasce atribuído a ela, sem passar por fila', async () => {
  db.seed('departments', [
    { id: DEPT, name: 'Departamento Pessoal', is_default: true },
    { id: 'dept-rh', name: 'Recursos Humanos', is_default: false },
  ]);
  db.seed('department_positions', [
    { id: 'pos-recr1', department_id: 'dept-rh', name: 'Recrutamento 1', user_id: 'user-ana' },
  ]);
  db.seed('department_connections', [
    { id: 'conn1', department_id: 'dept-rh', position_id: 'pos-recr1', instance: 'pricall' },
  ]);

  await handleInbound(post(EVOLUTION_URL, msg()));

  expect(db.rows('conversations')[0]).toMatchObject({
    department_id: 'dept-rh',
    assigned_to: 'user-ana',
  });
});

test('número de fila do departamento entra sem dono — o supervisor distribui', async () => {
  db.seed('departments', [{ id: DEPT, name: 'Departamento Pessoal', is_default: true }]);
  db.seed('department_connections', [
    { id: 'conn1', department_id: DEPT, position_id: null, instance: 'pricall' },
  ]);

  await handleInbound(post(EVOLUTION_URL, msg()));

  expect(db.rows('conversations')[0]).toMatchObject({ department_id: DEPT, assigned_to: null });
});

test('posição sem usuário vinculado não inventa responsável', async () => {
  db.seed('departments', [{ id: DEPT, name: 'DP', is_default: true }]);
  db.seed('department_positions', [
    { id: 'pos-vaga', department_id: DEPT, name: 'Ponto 1', user_id: null },
  ]);
  db.seed('department_connections', [
    { id: 'conn1', department_id: DEPT, position_id: 'pos-vaga', instance: 'pricall' },
  ]);

  await handleInbound(post(EVOLUTION_URL, msg()));
  expect(db.rows('conversations')[0]).toMatchObject({ assigned_to: null });
});

test('a conversa guarda a linha que recebeu, para responder pela mesma', async () => {
  db.seed('departments', [{ id: DEPT, name: 'DP', is_default: true }]);
  db.seed('department_connections', [
    { id: 'linha-3', department_id: DEPT, position_id: null, instance: 'pricall' },
  ]);

  await handleInbound(post(EVOLUTION_URL, msg()));
  expect(db.rows('conversations')[0]).toMatchObject({ connection_id: 'linha-3' });
});

// Um departamento com 20 linhas: escolher "a linha do departamento" faria o
// contato escrever para uma e ser respondido por outra.
test('duas linhas no mesmo departamento não se confundem', async () => {
  db.seed('departments', [{ id: DEPT, name: 'DP', is_default: true }]);
  db.seed('department_connections', [
    { id: 'linha-a', department_id: DEPT, position_id: null, instance: 'linha-a' },
    { id: 'linha-b', department_id: DEPT, position_id: null, instance: 'linha-b' },
  ]);

  await handleInbound(post(EVOLUTION_URL, { ...msg(), instance: 'linha-b' }));

  expect(db.rows('conversations')[0]).toMatchObject({ connection_id: 'linha-b' });
});

test('linha de fila segue a ordem do setor quando a distribui??o est? ativa', async () => {
  db.seed('departments', [{ id: DEPT, name: 'Departamento Pessoal', is_default: true }]);
  db.seed('department_connections', [
    { id: 'conn1', department_id: DEPT, position_id: null, instance: 'pricall' },
  ]);
  db.rpcResults.next_department_assignee = { data: 'user-atendente-2', error: null };

  await handleInbound(post(EVOLUTION_URL, msg()));

  expect(db.rows('conversations')[0]).toMatchObject({
    department_id: DEPT,
    assigned_to: 'user-atendente-2',
  });
  expect(db.rpcCalls).toContainEqual({
    name: 'next_department_assignee',
    args: { p_department_id: DEPT },
  });
});

test('linha pessoal de admin atende direto e nunca consulta a fila', async () => {
  db.seed('departments', [{ id: DEPT, name: 'Administra??o', is_default: true }]);
  db.seed('department_positions', [
    { id: 'pos-admin', department_id: DEPT, name: 'Admin', user_id: 'user-admin' },
  ]);
  db.seed('department_connections', [
    { id: 'conn-admin', department_id: DEPT, position_id: 'pos-admin', instance: 'pricall' },
  ]);
  db.rpcResults.next_department_assignee = { data: 'user-atendente-2', error: null };

  await handleInbound(post(EVOLUTION_URL, msg()));

  expect(db.rows('conversations')[0]).toMatchObject({
    department_id: DEPT,
    assigned_to: 'user-admin',
  });
  expect(db.rpcCalls.some((call) => call.name === 'next_department_assignee')).toBe(false);
});
