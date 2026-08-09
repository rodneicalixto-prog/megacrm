// Checks do pos-processamento da resposta do LLM. E a fronteira onde texto nao
// confiavel vira acao: vazar um marcador interno para o cliente, ou perder um
// handoff, sao os dois modos de falha que importam.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyVariables,
  extractHandoff,
  extractMedia,
  parseJsonLoose,
} from '../../supabase/functions/_shared/ai-reply.ts';

// -------------------------------------------------------------- handoff

test('[HANDOFF] em linha própria aciona e some do texto', () => {
  const got = extractHandoff('Vou te transferir.\n[HANDOFF]');
  assert.equal(got.handoff, true);
  assert.equal(got.text, 'Vou te transferir.');
});

test('marcador é case-insensitive', () => {
  for (const m of ['[handoff]', '[HandOff]', '[HANDOFF]']) {
    const got = extractHandoff(`ok\n${m}`);
    assert.equal(got.handoff, true, m);
    assert.equal(got.text, 'ok', m);
  }
});

test('marcador no meio do texto some do que o contato recebe', () => {
  const got = extractHandoff('Antes\n[HANDOFF]\nDepois');
  assert.equal(got.handoff, true);
  assert.equal(got.text.includes('[HANDOFF]'), false);
  assert.ok(got.text.includes('Antes') && got.text.includes('Depois'));
});

test('marcador sozinho vira handoff com texto vazio', () => {
  const got = extractHandoff('[HANDOFF]');
  assert.equal(got.handoff, true);
  assert.equal(got.text, '');
});

test('resposta comum não aciona handoff', () => {
  const got = extractHandoff('O horário de atendimento é das 9h às 18h.');
  assert.equal(got.handoff, false);
  assert.equal(got.text, 'O horário de atendimento é das 9h às 18h.');
});

// A palavra no meio de uma frase NAO e o marcador — o gate exige linha propria.
test('a palavra handoff no meio de uma frase não aciona', () => {
  const got = extractHandoff('Fazemos o handoff para um humano quando precisa.');
  assert.equal(got.handoff, false);
});

// ---------------------------------------------------------------- media

test('[MEDIA:rotulo] é extraído e sai do texto', () => {
  const got = extractMedia('Olha o catálogo [MEDIA:catalogo] e me diga.');
  assert.deepEqual(got.labels, ['catalogo']);
  assert.equal(got.text.includes('[MEDIA'), false);
});

test('vários marcadores viram vários rótulos, em ordem', () => {
  const got = extractMedia('[media:tabela] texto [MEDIA:foto-1]');
  assert.deepEqual(got.labels, ['tabela', 'foto-1']);
});

test('rótulo é normalizado para minúsculo', () => {
  assert.deepEqual(extractMedia('[MEDIA:Catalogo_PDF]').labels, ['catalogo_pdf']);
});

test('espaço em volta do rótulo é tolerado', () => {
  assert.deepEqual(extractMedia('[media:  catalogo  ]').labels, ['catalogo']);
});

test('sem marcador não inventa mídia', () => {
  const got = extractMedia('Bom dia! Como posso ajudar?');
  assert.deepEqual(got.labels, []);
  assert.equal(got.text, 'Bom dia! Como posso ajudar?');
});

test('media e handoff convivem na mesma resposta', () => {
  const media = extractMedia('Segue o material [MEDIA:catalogo]\n[HANDOFF]');
  const handoff = extractHandoff(media.text);
  assert.deepEqual(media.labels, ['catalogo']);
  assert.equal(handoff.handoff, true);
  assert.equal(handoff.text.includes('['), false);
});

// ------------------------------------------------------------ variáveis

test('variável conhecida é substituída', () => {
  assert.equal(applyVariables('Olá {nome}, tudo bem?', { nome: 'Rodnei' }), 'Olá Rodnei, tudo bem?');
});

test('variável desconhecida fica visível em vez de sumir', () => {
  assert.equal(applyVariables('Olá {desconhecida}', { nome: 'x' }), 'Olá {desconhecida}');
});

test('variável presente porém vazia vira string vazia', () => {
  assert.equal(applyVariables('[{vazio}]', { vazio: '' }), '[]');
});

test('sem mapa de variáveis o prompt passa intacto', () => {
  assert.equal(applyVariables('Olá {nome}', null), 'Olá {nome}');
});

test('substituição é case-insensitive na chave', () => {
  assert.equal(applyVariables('{NOME}', { NOME: 'A' }), 'A');
});

// ------------------------------------------------------------ JSON solto

test('JSON puro é lido', () => {
  assert.deepEqual(parseJsonLoose('{"stage":"proposta"}'), { stage: 'proposta' });
});

test('JSON dentro de cerca markdown é lido', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"moved":true}\n```'), { moved: true });
});

test('JSON com conversa em volta é lido', () => {
  const got = parseJsonLoose('Claro! Aqui vai:\n{"stage":"fechamento"}\nEspero ter ajudado.');
  assert.deepEqual(got, { stage: 'fechamento' });
});

test('resposta sem JSON devolve null em vez de explodir', () => {
  assert.equal(parseJsonLoose('Não consegui avaliar.'), null);
  assert.equal(parseJsonLoose(''), null);
});

test('JSON malformado devolve null', () => {
  assert.equal(parseJsonLoose('{"stage": }'), null);
  assert.equal(parseJsonLoose('}{'), null);
});
