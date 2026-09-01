// Guarda estática contra a classe de bug corrigida em useMeetings.ts em
// 01/09/2026: um .channel('nome-fixo') colide entre montagens (StrictMode,
// ou duas telas com o mesmo hook montado) e derruba a subscription, travando
// a tela. A correção sempre foi sufixar com algo não-estático (id aleatório
// por montagem, ou uma chave de recurso + sufixo). Não dá pra montar o hook
// de verdade aqui (o runner de testes é Node puro, sem jsdom/RTL), então este
// teste verifica a fonte: nenhuma chamada .channel(...) pode usar uma string
// literal fixa, só template literals com interpolação.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOKS_DIR = join(__dirname, '../../src/hooks');

// Casa .channel('...') / .channel("...") — string literal simples, sem
// interpolação. Um template literal (`...`) não bate aqui, mesmo que tenha
// texto fixo, porque o que importa é ter ${...} em algum lugar da chamada.
const STATIC_CHANNEL_CALL = /\.channel\(\s*(['"])(?:(?!\1).)*\1\s*\)/g;

test('nenhum hook usa .channel() com nome de canal estático', () => {
  const files = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.ts'));
  const offenders: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(HOOKS_DIR, file), 'utf8');
    const matches = content.match(STATIC_CHANNEL_CALL);
    if (matches) offenders.push(`${file}: ${matches.join(', ')}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `Canal Realtime com nome fixo (sem sufixo por montagem) — colide entre duas montagens do hook:\n${offenders.join('\n')}`,
  );
});

test('toda chamada .channel() com template literal interpola algo (não é só texto fixo)', () => {
  const files = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.ts'));
  const offenders: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(HOOKS_DIR, file), 'utf8');
    // .channel(`texto sem nenhuma ${interpolação}`) — mesmo risco que uma
    // string literal comum, só que com crase.
    const staticTemplate = /\.channel\(\s*`(?:(?!\$\{)[^`])*`\s*\)/g;
    const matches = content.match(staticTemplate);
    if (matches) offenders.push(`${file}: ${matches.join(', ')}`);
  }

  assert.deepEqual(offenders, [], `Template literal sem interpolação em .channel():\n${offenders.join('\n')}`);
});
