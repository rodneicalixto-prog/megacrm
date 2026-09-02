// Checks das funcoes puras que a aplicacao inteira apoia: normalizacao de
// telefone (chave de deduplicacao de contato), montagem de UTM (atribuicao),
// filtros do inbox e leitura de origem do lead.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizePhone } from '../../src/lib/phone.ts';
import { buildUtmUrl } from '../../src/lib/utm.ts';
import { dueBadge } from '../../src/lib/nextAction.ts';
import { getDealOrigin } from '../../src/lib/dealOrigin.ts';
import {
  matchesFilters,
  matchesQueue,
  lastSpeaker,
  DEFAULT_FILTERS,
} from '../../src/components/inbox/inbox-filters.ts';

// ---------------------------------------------------------------- phone.ts
// O E.164 e a chave de deduplicacao de contato: um numero que normaliza de duas
// formas vira dois contatos para a mesma pessoa.

test('telefone BR normaliza para E.164 a partir de formatos diferentes', () => {
  for (const raw of ['11987654321', '(11) 98765-4321', '11 98765 4321', '+55 11 98765-4321']) {
    const got = normalizePhone(raw);
    assert.equal(got.ok, true, raw);
    assert.equal(got.ok && got.e164, '+5511987654321', raw);
  }
});

test('número internacional com + é respeitado, não forçado para BR', () => {
  const got = normalizePhone('+351912345678');
  assert.equal(got.ok && got.e164, '+351912345678');
});

test('entradas inválidas são recusadas em vez de virarem contato torto', () => {
  for (const raw of ['', '   ', '123', 'abc', '0000000000000000']) {
    assert.equal(normalizePhone(raw).ok, false, JSON.stringify(raw));
  }
});

// ------------------------------------------------------------------ utm.ts

test('UTM preenchida entra na URL e a query existente é preservada', () => {
  const got = buildUtmUrl('https://exemplo.com/promo?ref=abc', {
    utm_source: 'instagram',
    utm_medium: 'paid_social',
    utm_campaign: 'black friday',
  });
  const url = new URL(got);
  assert.equal(url.searchParams.get('ref'), 'abc');
  assert.equal(url.searchParams.get('utm_source'), 'instagram');
  assert.equal(url.searchParams.get('utm_campaign'), 'black friday');
  assert.ok(got.includes('black+friday') || got.includes('black%20friday'), 'espaço deve ser encodado');
});

test('UTM vazia não polui a URL com parâmetro em branco', () => {
  const got = buildUtmUrl('https://exemplo.com', { utm_source: 'google', utm_medium: '  ' });
  assert.equal(new URL(got).searchParams.has('utm_medium'), false);
  assert.equal(new URL(got).searchParams.get('utm_source'), 'google');
});

test('UTM sobrescreve valor já presente na base em vez de duplicar', () => {
  const got = buildUtmUrl('https://exemplo.com?utm_source=antigo', { utm_source: 'novo' });
  assert.deepEqual(new URL(got).searchParams.getAll('utm_source'), ['novo']);
});

test('base relativa cai no fallback e mantém o hash no fim', () => {
  const got = buildUtmUrl('/promo#secao', { utm_source: 'x' });
  assert.equal(got, '/promo?utm_source=x#secao');
});

test('base vazia devolve vazio', () => {
  assert.equal(buildUtmUrl('   ', { utm_source: 'x' }), '');
});

// ------------------------------------------------------------ nextAction.ts

test('prazo vencido é marcado como atrasado', () => {
  const got = dueBadge(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  assert.equal(got.tone, 'overdue');
  assert.equal(got.short, 'Atrasada');
});

test('prazo daqui a pouco, no mesmo dia, é "hoje" e não futuro', () => {
  const now = new Date();
  // 5 min a frente; se isso cruzar a meia-noite o dia muda, entao empurra o
  // caso para o dia seguinte de proposito e valida o ramo 'future'.
  const soon = new Date(now.getTime() + 5 * 60 * 1000);
  const expected = soon.getDate() === now.getDate() ? 'today' : 'future';
  assert.equal(dueBadge(soon.toISOString()).tone, expected);
});

test('prazo em outro dia é futuro', () => {
  const got = dueBadge(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(got.tone, 'future');
});

// ------------------------------------------------------------ dealOrigin.ts

test('lead sem nenhum sinal aparece como não rastreado', () => {
  const got = getDealOrigin({});
  assert.equal(got.tracked, false);
  assert.equal(got.badge, 'Origem não rastreada');
  assert.equal(got.tone, 'outro');
});

test('lead nulo não quebra', () => {
  assert.equal(getDealOrigin(null).tracked, false);
  assert.equal(getDealOrigin(undefined).tracked, false);
});

test('só uma UTM já conta como rastreado', () => {
  assert.equal(getDealOrigin({ utm_source: 'instagram' }).tracked, true);
});

test('CTWA é a atribuição de confiança alta', () => {
  const got = getDealOrigin({ attribution_method: 'ctwa', traffic_type: 'pago' });
  assert.equal(got.method, 'Click-to-WhatsApp');
  assert.equal(got.methodReliability, 'alta');
  assert.equal(got.tone, 'pago');
});

test('método desconhecido cai em manual/baixa em vez de inventar confiança', () => {
  const got = getDealOrigin({ attribution_method: 'inventado', utm_source: 'x' });
  assert.equal(got.method, 'Manual');
  assert.equal(got.methodReliability, 'baixa');
});

// -------------------------------------------------------- inbox-filters.ts

const NOW = Date.parse('2026-08-08T12:00:00Z');
function conv(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    status: 'ai_active',
    channel: 'evolution',
    archived: false,
    assigned_to: null,
    tagIds: [],
    lastInboundAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    lastOutboundAt: null,
    isFavorite: false,
    priority: 'normal',
    unread_count: 0,
    department_id: null,
    connection_id: null,
    last_message_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    ...over,
  } as never;
}

test('sem filtro ativo, tudo passa', () => {
  assert.equal(matchesFilters(conv(), DEFAULT_FILTERS, NOW), true);
});

test('filtro de canal separa Evolution de WhatsApp oficial', () => {
  const f = { ...DEFAULT_FILTERS, channel: 'whatsapp' as const };
  assert.equal(matchesFilters(conv({ channel: 'evolution' }), f, NOW), false);
  assert.equal(matchesFilters(conv({ channel: 'whatsapp' }), f, NOW), true);
});

test('arquivada domina fechada na classificação de status', () => {
  const arquivada = conv({ archived: true, status: 'closed' });
  assert.equal(matchesFilters(arquivada, { ...DEFAULT_FILTERS, status: ['arquivadas'] }, NOW), true);
  assert.equal(matchesFilters(arquivada, { ...DEFAULT_FILTERS, status: ['fechadas'] }, NOW), false);
});

test('filtro "não atribuída" exclui as que já têm dono', () => {
  const f = { ...DEFAULT_FILTERS, assigned: 'unassigned' as const };
  assert.equal(matchesFilters(conv({ assigned_to: null }), f, NOW), true);
  assert.equal(matchesFilters(conv({ assigned_to: 'u1' }), f, NOW), false);
});

test('filtro de tag passa quando UMA das tags bate (OR dentro do eixo)', () => {
  const f = { ...DEFAULT_FILTERS, tagIds: ['t1', 't2'] };
  assert.equal(matchesFilters(conv({ tagIds: ['t2'] }), f, NOW), true);
  assert.equal(matchesFilters(conv({ tagIds: ['t9'] }), f, NOW), false);
});

test('janela: sem mensagem do contato conta como fora', () => {
  const f = { ...DEFAULT_FILTERS, janela: 'fora' as const };
  assert.equal(matchesFilters(conv({ lastInboundAt: null }), f, NOW), true);
  assert.equal(matchesFilters(conv(), f, NOW), false);
});

test('eixos diferentes se somam em E, não em OU', () => {
  const f = { ...DEFAULT_FILTERS, channel: 'evolution' as const, tagIds: ['t1'] };
  // canal bate, tag não → reprovado.
  assert.equal(matchesFilters(conv({ tagIds: ['outra'] }), f, NOW), false);
});


// ---- Filas da coluna esquerda do inbox ------------------------------------

test('a vez e de quem falou por ultimo', () => {
  const antes = new Date(NOW - 2 * 3600_000).toISOString();
  const depois = new Date(NOW - 3600_000).toISOString();
  assert.equal(lastSpeaker(conv({ lastInboundAt: depois, lastOutboundAt: antes })), 'contato');
  assert.equal(lastSpeaker(conv({ lastInboundAt: antes, lastOutboundAt: depois })), 'nos');
  assert.equal(lastSpeaker(conv({ lastInboundAt: null, lastOutboundAt: null })), null);
});

test('aguardando e aguardando cliente sao lados opostos, nunca ambos', () => {
  const antes = new Date(NOW - 2 * 3600_000).toISOString();
  const depois = new Date(NOW - 3600_000).toISOString();
  const nossaVez = conv({ lastInboundAt: depois, lastOutboundAt: antes });
  const vezDele = conv({ lastInboundAt: antes, lastOutboundAt: depois });
  assert.equal(matchesQueue(nossaVez, 'aguardando', null), true);
  assert.equal(matchesQueue(nossaVez, 'aguardando_cliente', null), false);
  assert.equal(matchesQueue(vezDele, 'aguardando', null), false);
  assert.equal(matchesQueue(vezDele, 'aguardando_cliente', null), true);
});

test('conversa encerrada sai das filas de trabalho', () => {
  const fechada = conv({ status: 'closed', assigned_to: null, closed_at: '2026-08-08T11:00:00Z' });
  assert.equal(matchesQueue(fechada, 'encerrados', null, NOW), true);
  assert.equal(matchesQueue(fechada, 'nao_atribuidos', null), false);
  assert.equal(matchesQueue(fechada, 'aguardando', null), false);
  assert.equal(matchesQueue(conv({ status: 'closed', unread_count: 3 }), 'nao_lidos', null), false);
});

test('meus atendimentos exige um usuario — sem sessao nao cai tudo na fila', () => {
  const minha = conv({ assigned_to: 'u1' });
  assert.equal(matchesQueue(minha, 'meus', 'u1'), true);
  assert.equal(matchesQueue(minha, 'meus', 'u2'), false);
  assert.equal(matchesQueue(conv({ assigned_to: null }), 'meus', null), false);
});

test('favoritos ignora o arquivamento; as demais filas nao', () => {
  const arquivadaFavorita = conv({ archived: true, isFavorite: true });
  assert.equal(matchesQueue(arquivadaFavorita, 'favoritos', null), true);
  assert.equal(matchesQueue(arquivadaFavorita, 'nao_lidos', null), false);
});

test('a fila manda no status: encerrados nao e vencido pelo default abertas', () => {
  const fechada = conv({ status: 'closed', closed_at: '2026-08-08T11:00:00Z' });
  const f = { ...DEFAULT_FILTERS, queue: 'encerrados' as const };
  assert.equal(matchesFilters(fechada, f, NOW), true);
});

test('filtrar por numero separa duas linhas do mesmo departamento', () => {
  const f = { ...DEFAULT_FILTERS, connectionId: 'linha-a' };
  assert.equal(matchesFilters(conv({ connection_id: 'linha-a' }), f, NOW), true);
  assert.equal(matchesFilters(conv({ connection_id: 'linha-b' }), f, NOW), false);
});
