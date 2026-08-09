// Checks da montagem do template de broadcast. O modo de falha que importa: uma
// variavel sem literal vira parametro vazio, a Meta recusa com "Required
// template parameter is missing", e o disparo some sem ninguem notar. Por isso
// `missing` precisa estar certo — e o que faz o dispatcher falhar a linha.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildBroadcastComponents,
  chunk,
  countVariables,
  renderTemplatePreview,
  type VariableSource,
} from '../../supabase/functions/_shared/campaign-template.ts';

const lit = (value: string): VariableSource => ({ source: 'literal', value });

// ------------------------------------------------------- countVariables

test('conta variáveis distintas, não ocorrências', () => {
  assert.equal(countVariables('Olá {{1}}, seu pedido {{2}} — {{1}} confirmado.'), 2);
});

test('tolera espaço dentro das chaves', () => {
  assert.equal(countVariables('{{ 1 }} e {{2}}'), 2);
});

test('template sem variável conta zero', () => {
  assert.equal(countVariables('Mensagem fixa, sem variável.'), 0);
  assert.equal(countVariables(''), 0);
});

test('{{texto}} não é variável — só índice numérico', () => {
  assert.equal(countVariables('Olá {{nome}}'), 0);
});

// ----------------------------------------------- buildBroadcastComponents

test('template sem variável não gera componente nenhum', () => {
  const got = buildBroadcastComponents({ body: 'Olá!' }, null);
  assert.deepEqual(got.components, []);
  assert.deepEqual(got.missing, []);
});

test('literais preenchidos geram os parâmetros na ordem', () => {
  const got = buildBroadcastComponents(
    { body: 'Olá {{1}}, pedido {{2}}' },
    { '1': lit('Rodnei'), '2': lit('#123') },
  );
  assert.deepEqual(got.missing, []);
  assert.deepEqual(got.components, [
    { type: 'body', parameters: [{ type: 'text', text: 'Rodnei' }, { type: 'text', text: '#123' }] },
  ]);
});

test('variável sem mapeamento entra em missing', () => {
  const got = buildBroadcastComponents({ body: '{{1}} {{2}}' }, { '1': lit('A') });
  assert.deepEqual(got.missing, [2]);
});

test('literal só com espaço conta como faltante, não como valor', () => {
  const got = buildBroadcastComponents({ body: '{{1}}' }, { '1': lit('   ') });
  assert.deepEqual(got.missing, [1]);
});

// Broadcast e o mesmo texto para todos: campo do contato nao tem como ser
// resolvido aqui, entao TEM que virar missing em vez de parametro vazio.
test('campo do contato não é personalizável em broadcast e vira faltante', () => {
  const got = buildBroadcastComponents(
    { body: 'Olá {{1}}' },
    { '1': { source: 'contact_field', field: 'name' } },
  );
  assert.deepEqual(got.missing, [1]);
});

test('campo customizado também vira faltante', () => {
  const got = buildBroadcastComponents(
    { body: '{{1}}' },
    { '1': { source: 'custom_field', field: 'empresa' } },
  );
  assert.deepEqual(got.missing, [1]);
});

test('mapeamento nulo deixa todas faltantes', () => {
  assert.deepEqual(buildBroadcastComponents({ body: '{{1}} {{2}} {{3}}' }, null).missing, [1, 2, 3]);
});

// ------------------------------------------------------------- chunk

test('divide em lotes do tamanho pedido', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('lista menor que o lote sai inteira', () => {
  assert.deepEqual(chunk([1, 2], 100), [[1, 2]]);
});

test('lista vazia não gera lote', () => {
  assert.deepEqual(chunk([], 10), []);
});

test('divisão exata não gera lote vazio no fim', () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

// --------------------------------------------------- renderTemplatePreview

test('preview aplica os literais', () => {
  const got = renderTemplatePreview('Olá {{1}}, pedido {{2}}', { '1': lit('Ana'), '2': lit('#9') });
  assert.equal(got, 'Olá Ana, pedido #9');
});

test('variável sem literal continua visível no preview', () => {
  const got = renderTemplatePreview('Olá {{1}} e {{2}}', { '1': lit('Ana') });
  assert.equal(got, 'Olá Ana e {{2}}');
});

test('preview repete o literal em todas as ocorrências da mesma variável', () => {
  assert.equal(renderTemplatePreview('{{1}} e {{1}}', { '1': lit('X') }), 'X e X');
});

test('campo do contato não é resolvido no preview', () => {
  const got = renderTemplatePreview('{{1}}', { '1': { source: 'contact_field', field: 'name' } });
  assert.equal(got, '{{1}}');
});
