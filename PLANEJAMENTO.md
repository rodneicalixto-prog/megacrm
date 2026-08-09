# MegaCRM — Avaliação do Repositório e Planejamento

> Avaliação original: 2026-08-08, sobre o commit `f01d683`.
> Última atualização: 2026-08-08, sobre `52bebdd` (`main`).

---

## 1. Onde estamos

| | |
|---|---|
| **Repositório** | ✅ código versionado, 281 arquivos |
| **CI** | ✅ lint · typecheck · SQL · build · testes |
| **Deploy Vercel** | ✅ `megacrm`, produção verde, 7 serverless |
| **Testes** | ✅ 51 unitários (Vitest) + 9 E2E · lint e tipos em toda a base |
| **Banco Supabase** | ⏳ wizard `/setup` em andamento |
| **Rota WhatsApp** | ✅ Zernio (oficial) + Evolution API v2 |

O diagnóstico que abriu este documento — *"o produto é sólido; o repositório
não existe"* — está resolvido. As Fases 0, 1 e 2 foram executadas. O que falta
é ligar o banco e cobrir o núcleo com teste.

---

## 2. Diagnóstico original (histórico)

O repositório tinha **1 commit** e **1 arquivo**: um ZIP de 1,2 MB com a
aplicação inteira lacrada dentro. Sem diff, sem blame, sem PR, sem rollback.
O `.github/workflows/ci.yml` existia *dentro do ZIP*, então o GitHub nunca o
enxergava e a CI nunca rodava.

O ZIP também carregava o que o próprio `.gitignore` do projeto excluía:
`__MACOSX/` (71 arquivos), 4 × `.DS_Store`, `dist/` compilado, caches
`.tsbuildinfo` e um `supabase/.temp/linked-project.json` que expunha o project
ref e o organization id do Supabase.

Nenhuma credencial real foi encontrada na varredura.

> Isso também explica os 3 deploys que falhavam na Vercel: apontavam para o
> repo `super_calixto_crm`, descompactado pela metade — com `package.json` mas
> sem `src/` nem `supabase/`. O build morria em
> `TS18003: No inputs were found... 'include' paths were ["src"]`.

---

## 3. O produto

**MegaCRM / `whatsapp-hub`** — plataforma self-hosted de automação WhatsApp
para uma organização: templates assistidos por IA, campanhas em massa com tier
da Meta, inbox em tempo real com handoff IA↔humano, RAG, funil de vendas,
atribuição de UTM e dashboard.

### Stack

- **Front:** React 18 · Vite · TypeScript · Tailwind v4 · shadcn/ui
- **Back:** Supabase (Postgres, Auth, Realtime, Edge Functions, Storage,
  pgvector, `pg_cron`, `pg_net`)
- **WhatsApp:** Zernio (oficial, relay Meta Cloud API) · Evolution API v2
  (não-oficial, self-hosted)
- **Deploy:** Vercel (SPA + 7 serverless functions)

### Dimensão

| Área | Linhas | Arquivos |
|---|---:|---:|
| `src/` (frontend) | 21.186 | 120 |
| `supabase/migrations/` | 6.342 | 69 |
| `supabase/functions/` | 5.880 | 22 funções |
| `api/` (serverless Vercel) | 1.223 | 7 |
| `tests/` | ~1.200 | 9 specs E2E + 51 unit |

### O que está genuinamente bom

- ✅ **Build limpo** — ~9 s, sem erro nem warning.
- ✅ **Disciplina de tipos** — `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. **Apenas 2 `any` em toda a base.** Isso é raro.
- ✅ **Segurança bem pensada** — webhooks com HMAC-SHA256 *timing-safe*;
  `requireAdmin`/`requireCaller`/`requireServiceRole` padronizados; credenciais
  criptografadas em `app_settings` com `CRYPTO_KEY`; ~130 policies RLS.
- ✅ **Documentação acima da média** — `AGENTS.md`, `CLAUDE.md`, `README`,
  `INSTALL`, `CHANGELOG` no padrão Keep a Changelog, e `src/customizations/`
  como zona segura para forks locais.

---

## 4. Riscos — situação atual

### ✅ R1 — `api/` fora do type-check — resolvido

`tsconfig.app.json` só incluía `src`, então os 7 serverless nunca eram
compilados. Escondia um erro real no caminho mais crítico do produto:

```
api/bootstrap.ts(536,24): error TS18048: 'body' is possibly 'undefined'.
```

`tsconfig.api.json` cobre `api/` e `setup.config.ts`; o erro foi corrigido com
guard explícito. Era o item aberto do `ISSUES.md`.

### ✅ R2 — CI que não verificava nada — resolvido

Rodava `npm run lint --if-present` contra um script `lint` inexistente (no-op)
e depois `npm run build`. Hoje roda **lint → typecheck → validate:sql → build →
test:unit → test:e2e**, com upload de artefato do Playwright em falha.

> O step do Playwright **não pôde ser exercitado localmente** — o ambiente de
> trabalho tinha Chromium 1194 e o `@playwright/test` pede 1223, com download
> bloqueado. Ele roda pela primeira vez no GitHub Actions.

### 🟠 R3 — Cobertura de teste no lugar errado — em andamento

As 9 specs E2E cobriam **só o wizard `/setup`**. A Fase 3 somou **51 checks
unitários** (Vitest) sobre o que carrega risco: gate HMAC dos webhooks, os dois
adapters de WhatsApp, normalização de telefone, montagem de UTM, filtros do
inbox e leitura de origem do lead.

Continuam descobertos: disparo de campanhas, funil e o agente de IA — os três
dependem de I/O com o banco e precisam de mock, ao contrário do que já foi
coberto. Ficam para a continuação da Fase 3.

### 🟠 R4 — Vulnerabilidades de dependência — parcialmente aberto

De **5** para **3**. Detalhe completo, exposição e comando de correção em
`ISSUES.md`.

| Pacote | Severidade | Situação |
|---|---|---|
| `ws` | high | ✅ resolvido por `npm audit fix` |
| `xlsx@0.18.5` | high | ⏳ aberto — SheetJS saiu do npm; fix é o tarball do CDN |
| `react-router-dom` | moderate | ⏳ aberto por decisão — advisories não alcançáveis |

### 🟡 R5 — Peso do bundle

`index` 449 KB + `PieChart` (recharts) 374 KB + `xlsx` 332 KB. Há
code-splitting por rota, mas recharts e xlsx passam de 700 KB juntos. Candidatos
a import dinâmico.

### 🟡 R6 — 69 migrations lineares

A cadeia inclui `drop_super_admin`, `drop_multitenant`, `drop_onboarding` —
migrations que desfazem arquitetura antiga. Toda instalação nova cria e depois
destrói o modelo multi-tenant. Alonga o `/setup` e amplia a superfície de falha.

### 🟡 R7 — Divergência doc/código — quase resolvido

A rota não-oficial passou de Uazapi para Evolution API v2 e o `README` agora
documenta as duas rotas corretamente. **Sobra:** o `AGENTS.md` ainda cita
`META_*` e `LLM_PROVIDER` como env vars, que o `README` diz não existirem mais.

### ✅ R8 — Endpoints públicos sem rate limit — resolvido

`ingest-lead` roda com `--no-verify-jwt` e CORS aberto (é chamado do browser da
landing). Sem limite, um bot inundava o CRM de leads falsos. Hoje: janela fixa
por IP, 20 req/min, via a RPC `bump_rate_limit`.

> Falha do limitador **deixa passar**, e isso é deliberado: perder lead real por
> erro de infra é pior que admitir um lead a mais. É anti-flood, não é gate de
> segurança.

> `redirect-tracker` ficou de fora **por desenho** — é fire-and-forget e precisa
> sempre redirecionar rápido. O risco lá é inflar `tracking_sessions`, não
> poluir o pipeline.

---

## 5. Execução

### ✅ Fase 0 — Destravar o Git — `27492ba`

281 arquivos descompactados, ZIP removido do versionamento, lixo fora
(`__MACOSX/`, `.DS_Store`, `dist/`, `.tsbuildinfo`, `supabase/.temp/`).
Diff, blame, PR, CI e rollback voltaram a funcionar.

### ✅ Fase 1 — CI que verifica — `0af5b8e`

`tsconfig.api.json`, correção do `TS18048`, ESLint com config plana separada
por runtime, pipeline completa no workflow.

> Regras da era React Compiler (`set-state-in-effect`, `purity`) ficaram como
> **warning**: sinalizavam 53 ocorrências de padrões idiomáticos desta base.
> Erro de verdade fica erro — o gate precisa significar algo hoje.
>
> Um achado real saiu daí: `FollowUpsPage` usava `useMemo` como efeito, com
> `setState` dentro. O React pode descartar e reexecutar um memo, então aquilo
> era sincronização não confiável. Virou `useEffect`.

### ✅ Fase 2 — Segurança e dependências — `52bebdd`

`npm audit fix`, rate limit no `ingest-lead`, Dependabot (minor/patch agrupados,
major separado), `ISSUES.md` reescrito.

**Duas decisões de não fazer**, ambas documentadas em `ISSUES.md`:

- **`xlsx`** — a SheetJS saiu do registry npm; o fix é o tarball do CDN deles,
  bloqueado no ambiente de trabalho. Mexer no `package.json` sem conseguir
  instalar dessincronizaria o lockfile e quebraria o `npm ci` — pior que a issue
  aberta. O `@e965/xlsx` do npm corrige, mas é republicação de terceiro: para um
  pacote que faz parse de arquivo do usuário, isso move risco em vez de fixar.
- **`react-router`** — as 3 advisories foram checadas contra o código e nenhuma
  é alcançável: todo destino de navegação é path literal com UUID do banco, e a
  advisory de hidratação SSR precisa de SSR que uma SPA Vite não tem. Subir para
  7.x sem cobertura de rota trocaria risco teórico por regressão real.

### ✅ Fora do plano — rota Evolution API — `3159c39` + `4a3db65`

A rota não-oficial passou de Uazapi para Evolution API v2, seguindo a costura
que o projeto já tinha (*"adicionar provedor = escrever um adapter novo, sem
tocar no core"*). Endpoints confirmados na doc oficial, não chutados.

- Evolution e Uazapi falam Baileys: o decoder saiu de dentro do adapter Uazapi
  para `types.ts`, então não existem duas cópias para divergir.
- Migration `20260808120000` renomeia `channel = 'uazapi'` → `'evolution'` e
  reprefixa os ids de mensagem, mantendo o histórico respondível. Idempotente.
- `webhookByEvents` fica **false** no registro do webhook: ligado, ele anexaria
  o nome do evento ao path e quebraria a rota única da Edge Function.

### 🟩 Fase 3 — Testar onde está o risco — primeira rodada feita

**Pré-requisito, resolvido primeiro:** `supabase/functions/` não passava por
`tsc` nem por ESLint. `tsconfig.functions.json` mais um `_deno.d.ts` com as 3
APIs do runtime (`Deno.serve`, `Deno.env`, `EdgeRuntime.waitUntil`) puseram as
5.880 linhas sob compilador. **Achou 3 erros reais na primeira execução**, um
deles bug de comportamento (ver abaixo).

Feito:

1. ✅ **Gate HMAC dos webhooks** — estava duplicado entre `zernio-webhook` e
   `whatsapp-inbound`. Extraído para `_shared/signature.ts` e coberto por 11
   checks: hex e base64, prefixo `sha256=`, corpo adulterado, segredo errado,
   header ausente, comparação sem match parcial.
2. ✅ **Adapters de WhatsApp** — Evolution (12) e Zernio (5).
3. ✅ **Funções puras** — `phone.ts`, `utm.ts`, `nextAction.ts`, `dealOrigin.ts`
   e os filtros do inbox (23).
4. ⏳ **Dispatcher de campanha**, **agente de IA** e **funil** — dependem de I/O
   com o banco; precisam de mock antes.

**Runner:** Vitest, um só para os dois lados. O `node:test` da stdlib cobria os
adapters (TypeScript puro), mas não resolve o alias `@/` nem imports sem
extensão do lado do frontend — e contorcer o código-fonte para agradar o runner
sairia mais caro que a dependência.

**Bug encontrado pelo type-check:** `zernio-provider.extractReferral` encadeava
`x && asObject(x)` para achar o `ctwa_clid` em três lugares possíveis. Objeto
vazio é *truthy*, então um `referral: {}` no primeiro candidato interrompia a
busca e os outros dois nunca eram olhados — atribuição de anúncio perdida em
silêncio. Corrigido e travado por teste de regressão.

### ⏳ Fase 4 — Consolidação técnica — 2–3 semanas

1. **Baseline de migrations (R6)** — `_baseline.sql` do schema atual, arquivando
   as 69 históricas. Instalação nova passa a aplicar 1 arquivo.
2. **Documentação (R7)** — remover `META_*` e `LLM_PROVIDER` do `AGENTS.md`.
3. **Bundle (R5)** — import dinâmico de `xlsx` e recharts.
4. Quebrar os arquivos maiores: `SetupPage.tsx` (896), `DealDrawer.tsx` (710),
   `process-ai-message/index.ts` (709).

### ⏳ Fase 5 — Produto

Só depois da Fase 3. Pauta sugerida: multi-número, relatórios exportáveis, API
pública, i18n (o v1 é PT-BR fixo por decisão explícita).

---

## 6. Pendências fora do código

1. **Rotacionar a chave Zernio** exposta em conversa (`sk_287ef…`).
2. **Concluir o `/setup`** no projeto Supabase de destino — é o que cria as
   tabelas.
3. **Aplicar o fix do `xlsx`** de uma máquina com acesso a `cdn.sheetjs.com`
   (comando em `ISSUES.md`).
4. **Atualizar o checklist do Agentise** — o passo 11 ainda aponta para
   `uazapi.dev`; a rota não-oficial agora é Evolution.
5. **Limpar `super_calixto_crm`** — repo meio-descompactado com 2 projetos
   Vercel mortos apontados para ele.
6. `run_secret_scanning` no repositório.
