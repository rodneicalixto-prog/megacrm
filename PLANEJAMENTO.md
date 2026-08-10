# MegaCRM — Avaliação do Repositório e Planejamento

> Avaliação original: 2026-08-08, sobre o commit `f01d683`.
> Última atualização: 2026-08-10, branch `work`.

---

## 1. Onde estamos

| | |
|---|---|
| **Repositório** | ✅ código versionado, 328 arquivos rastreados |
| **CI** | ✅ lint · typecheck · SQL · build · testes |
| **Deploy Vercel** | ⚠️ `megacrm`, 7 serverless; deploy remoto a confirmar |
| **Testes** | ✅ 147 unitários (Vitest) + 9 E2E · lint e tipos em toda a base |
| **Banco Supabase** | ⚠️ `yshvniyhtnyhnjcecbft` — 87 migrations locais, 22 functions; deploy remoto a confirmar |
| **Rota WhatsApp** | ✅ Evolution API v2 · roteamento por linha/departamento |

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
| `src/` (frontend) | 23.600 | 132 |
| `supabase/migrations/` | 7.757 | 87 |
| `supabase/functions/` | 6.322 | 22 funções |
| `api/` (serverless Vercel) | 1.296 | 7 |
| `tests/` | 2.282 | 9 specs E2E + 9 arquivos unitários (147 testes) |

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

### ✅ R3 — Cobertura de teste no lugar errado — resolvido

As 9 specs E2E cobriam **só o wizard `/setup`**. A Fase 3 somou **107 checks
unitários** (Vitest) sobre o que carrega risco: gate HMAC dos webhooks, os dois
adapters de WhatsApp, pós-processamento da resposta do LLM, montagem do template
de broadcast, horário comercial, normalização de telefone, montagem de UTM,
filtros do inbox e leitura de origem do lead.

O `whatsapp-inbound` — único ponto por onde mensagem de fora entra no CRM — é
exercitado **inteiro**, do POST até o estado no banco, contra um dublê em
memória do client Supabase (`tests/unit/helpers/fake-supabase.ts`, 110 linhas,
só as cadeias que as functions usam).

**A cobertura foi verificada por mutação**, não pelo número de testes passando:

| Mutação introduzida | Testes que quebraram |
|---|---|
| gate de assinatura sempre aprova | 8 |
| `fromMe` nunca detectado | 5 |
| variável faltante não reportada no template | 5 |
| filtro de grupo removido | 2 |

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
4. ✅ **Pós-processamento da resposta do LLM** — `_shared/ai-reply.ts` (24
   checks). É a fronteira onde texto não confiável vira ação: vazar `[HANDOFF]`
   para o cliente ou perder um handoff são os dois modos de falha que importam.
5. ✅ **Montagem do template de broadcast** — `_shared/campaign-template.ts`
   (19 checks). Variável sem literal tem que virar `missing`, senão a Meta
   recusa com *"Required template parameter is missing"* e o disparo some sem
   ninguém notar.
6. ✅ **Horário comercial** — `_shared/business-hours.ts` (15 checks), com o
   relógio injetável para o teste fixar o instante. Não há gate no código: o
   prompt decide. Um `dentro_do_horario` errado faz o agente atender de
   madrugada.
7. ✅ **`whatsapp-inbound` de ponta a ponta** (16 checks) — método, JSON
   inválido, credencial ausente, caminho feliz, reuso de contato, idempotência,
   grupo, broadcast, evento não-mensagem, resposta do dono pelo celular, e as
   três formas de burlar a assinatura na rota Zernio.

   Destravado exportando o handler: `Deno.serve(handleInbound)` no fim do
   módulo em vez do handler inline, senão importar o arquivo num teste sobe um
   servidor.

**Runner:** Vitest, um só para os dois lados. O `node:test` da stdlib cobria os
adapters (TypeScript puro), mas não resolve o alias `@/` nem imports sem
extensão do lado do frontend — e contorcer o código-fonte para agradar o runner
sairia mais caro que a dependência.

**Padrão adotado:** separar a decisão do I/O. Quatro módulos `_shared` novos
(`signature`, `ai-reply`, `campaign-template`, `business-hours`, 261 linhas no
total) tiraram lógica pura de dentro dos `index.ts`, que misturavam as duas
coisas e por isso não tinham como ser testados. O bundler já inlina `_shared`
uma vez só, então não há custo em runtime.

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

## 6. Decisões de produto tomadas no caminho

- **Agente de IA é opt-in.** O default era ligado, herdado de quando se assumia
  número comercial novo. Na rota não-oficial o número conectado costuma estar em
  uso — o agente respondia cliente antigo, fornecedor e conversa pessoal no
  primeiro minuto depois do setup. Ligar é um clique; desfazer um agente que já
  falou com 174 contatos, não. Migration `20260808140000`.

---

## 7. Pendências fora do código

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

---

## 8. Estado operacional da instalação (10/08/2026)

Não é planejamento — é o que está de pé agora, no projeto Supabase
`yshvniyhtnyhnjcecbft` e no deploy de produção da Vercel.

### Infra

| | |
|---|---|
| **Produção** | `megacrm-git-main-rodnei-calixto-s-projects.vercel.app` |
| **Último deploy** | `6e8f8d6`, READY, 7 serverless |
| **Banco** | `yshvniyhtnyhnjcecbft` (o `lxozaxrckrzwhckzsxmv` foi abandonado — o wizard rodou no projeto errado e o dado lá era 1 contato/1 conversa) |
| **Rota WhatsApp** | Evolution API v2, instância `pricall` → +55 19 96712-8359 |
| **Agente de IA** | **travado no trigger** — `is_active = false` e o disparo nem acontece |
| **Rota oficial (Zernio)** | fora de escopo nesta fase |

### Organização carregada no banco

9 departamentos, 17 cargos, 1 linha conectada, 1 usuário (`super_admin`).

| Departamento | Cargos | Linhas | Observação |
|---|---:|---:|---|
| Departamento Pessoal | 7 | 1 | **default** — recebe o que chega de instância desconhecida |
| Recursos Humanos | 6 | 6 | modelo "1 número por pessoa" (fila não se aplica) |
| Seguranca | 3 | 0 | |
| Gerencia | 1 | 0 | Priscilla Klein |
| Administracao Geral | 0 | 0 | caixa reservada do super_admin |
| Faturamento · Diretoria · Seguranca do Trabalho · Geral | 0 | 0 | cargos ainda não definidos |

Departamento Pessoal: Supervisor, Admissão, Rescisão, Ponto 1, Ponto 2,
Benefícios, Arquivos — todos na **fila** da linha única do departamento.

Recursos Humanos: Supervisor de RH, Recrutamento 1/2/3, Discolabs, Estágios —
cada um com **número próprio** (`department_connections.position_id` preenchido),
então a conversa nasce já atribuída e não entra em fila.

### Rota Evolution — validada ponta a ponta

Webhook reapontado para o banco novo e mensagem real recebida: contato criado,
conversa aberta no Departamento Pessoal, thread renderizando. O card de status
mostrava "Não conectado" com a instância conectada — a rota lia só
`body.instance.state` e esta Evolution devolve o estado em outra chave; corrigido
em `680f9f5`.

### Linhas conectadas (13)

O roteamento é por **nome de instância** da Evolution. Cada linha foi verificada
com uma chamada real à `whatsapp-inbound` via `pg_net`, conferindo o setor e o
destino gravados na conversa; os contatos de teste foram apagados depois.

| Instância | Setor | Destino | Número |
|---|---|---|---|
| `pricall` | Diretoria | Diretor (Rodnei) | +55 11 93221-2892 |
| `departamento_pessoal` | Departamento Pessoal | fila do supervisor | — |
| `gerencia` | Gerência | Priscilla Klein | — |
| `rh_supervisor` | Recursos Humanos | Supervisor de RH | — |
| `estagios` | Recursos Humanos | Estágios | — |
| `rh_jheny` | Recursos Humanos | Recrutamento 1 | +55 11 94291-7761 |
| `rh_discolab` | Recursos Humanos | Discolabs | +55 11 96472-8346 |
| `rh_linha_02` | Recursos Humanos | fila do supervisor | +55 11 91867-1880 |
| `rh_linha_03` | Recursos Humanos | fila do supervisor | +55 11 94216-7315 |
| `rh_linha_04` | Recursos Humanos | fila do supervisor | +55 11 94355-2467 |
| `rh_linha_06` | Recursos Humanos | fila do supervisor | +55 11 99260-3043 |
| `portaria1` | Segurança | Portaria 1 | — |
| `portaria2` | Segurança | Portaria 2 | — |

O `pricall` era a fila do Departamento Pessoal e passou a ser a linha pessoal do
diretor. O DP não ficou sem número: tem a instância `departamento_pessoal`.

**Atribuição automática está provada.** O teste do `rh_supervisor` abriu a
conversa já no nome do supervisor de RH, não na fila — é o primeiro cargo com
pessoa vinculada a receber mensagem.

"Destino = fila do supervisor" significa `position_id` nulo: a conversa nasce
sem dono e o supervisor distribui. Com `position_id`, ela já nasce atribuída à
pessoa daquele cargo — assim que essa pessoa tiver login. Hoje nenhum cargo tem
usuário vinculado, então tudo cai na fila mesmo com o cargo definido.

As quatro linhas `rh_linha_0*` ficaram sem cargo de propósito: sem dono definido
é melhor a fila do que atribuir à pessoa errada.

**Departamento Pessoal tem duas linhas** (`pricall` e `departamento_pessoal`) —
é suportado, e é por isso que a conversa guarda `connection_id`: a resposta tem
que sair pela linha que recebeu, não por "a linha do departamento".

### Contas dos 17 cargos criadas

Todas entregues na caixa da Gerência, por sufixo `+`:
`priscilla.klein+dp_supervisor@gmail.com`, `+rh_recrutamento1`, `+seg_portaria1`,
`+ger_priscillaklein`, e assim por diante.

O sufixo não é preferência estética: o Supabase Auth exige e-mail único, então
dezessete contas não cabem num endereço só. O Gmail entrega todos os `+algo` na
mesma caixa, e trocar o e-mail depois é um `update` por linha.

| Papel | Quem | Quantos |
|---|---|---|
| `super_admin` | dono, em Administração Geral | 1 |
| `admin` | Gerência | 1 |
| `supervisor` | um por departamento com fila (DP, RH, Segurança) | 3 |
| `operator` | demais cargos | 13 |

Cada conta está vinculada ao seu cargo (`department_positions.user_id`), então a
linha daquele cargo passa a abrir conversa **já atribuída** à pessoa. O
`app_users.department_id` foi corrigido para o departamento do cargo — o trigger
`handle_new_user` põe todo mundo no default, e é esse campo que as policies leem.

**Ninguém tem senha ainda**, de propósito: cada um define a sua por *Esqueci
minha senha* na tela de login. Nenhuma senha compartilhada circulou. Atenção ao
SMTP padrão do Supabase, que limita poucos e-mails por hora — fazer aos poucos,
ou configurar SMTP próprio antes de liberar os dezessete.

### Depois disso, em ordem

1. Definir os cargos de Faturamento, Diretoria e Segurança do Trabalho.
2. Horário de atendimento **por usuário e por setor** — substitui o filtro de
   período que chegou a existir no inbox e foi removido por não ser isso.
3. ~~Redeploy da `whatsapp-inbound`~~ — **feito** (versão 2, via MCP).
   Verificado com três chamadas reais pelo `pg_net`: instância `estagios` →
   Recursos Humanos com `connection_id` gravado; instância inexistente →
   Departamento Pessoal, sem chutar; mensagem de grupo ignorada. Dados de teste
   removidos depois.
4. **`send-operator-message` ainda sai pela credencial global.** A resposta a
   uma conversa de RH sairia pelo `pricall` em vez da linha que recebeu. Não
   morde ainda porque ninguém definiu senha, mas passa a morder no primeiro
   atendente que entrar e responder pelo CRM numa linha própria.
   Deploy pendente.

### Agenda (`/agenda`)

Calendário mensal com duas naturezas na mesma tabela, separadas por `owner_id`:

- **Minha agenda** — uma por usuário, criada por trigger quando o usuário entra
  em `app_users`. Sem isso a tela abriria vazia e sem onde criar nada.
- **Calendário da empresa** — único (`is_company`, com índice parcial), lido por
  todos e **escrito só por `admin` e `super_admin`** (gerência e diretoria).
  Supervisor lê, não escreve: é mural da empresa, não quadro de setor. Não pode
  ser apagado — não há policy de delete que o alcance.

O filtro do mês busca por **sobreposição** (`starts_at < fim AND ends_at >
início`), não por contenção: um evento que começou ontem e termina amanhã
pertence a hoje, e filtrar só por `starts_at` o esconderia.

### Setores e usuários (Configurações → Setores)

Três coisas na mesma aba, porque são a mesma decisão:

1. **Cadastrar usuário** — Nome · E-mail · Função · Equipe/setor, mais o cargo
   opcional. Com cargo, a conversa que chegar na linha daquele cargo já nasce no
   nome da pessoa; sem cargo, cai na fila do supervisor.
2. **Setores** — criar e excluir. O padrão recusa exclusão: é para onde caem as
   mensagens de linha desconhecida, e sem ele elas passam a ser recusadas.
3. **Cargos** — criar, excluir e vincular a pessoa.

O cadastro é a RPC `create_user`, `SECURITY DEFINER` porque escrever em
`auth.users` exige privilégio que o `authenticated` não tem — e por isso a
primeira coisa que ela faz é conferir `is_admin()`. Sem essa checagem seria uma
porta para qualquer usuário logado criar um `super_admin`. `super_admin` ficou
de fora das funções aceitas de propósito: é o dono da instalação, criado uma vez
no bootstrap, não algo que se cadastra por formulário.

A conta nasce **sem senha** — a pessoa define a dela em "Esqueci minha senha",
o mesmo caminho das dezessete iniciais, e nenhuma senha compartilhada circula.

`app_users.full_name` foi adicionada e `list_operators` passou a devolver nome e
setor: com dezessete contas sufixadas na mesma caixa, o e-mail não identificava
ninguém, e três seletores diferentes mostravam
`priscilla.klein+seg_portaria1@gmail.com` onde devia estar um nome.

### Correções de RLS encontradas no caminho

Duas, ambas invisíveis até alguém usar o navegador em vez de service role:

1. **42 policies em 41 tabelas listavam só `admin` e `operator`.** O dono é
   `super_admin` desde a migração de hierarquia, então ele não escrevia em
   *nada* pelo app; supervisor idem. Passou despercebido porque quase tudo feito
   até agora saiu por API Route com service role, que ignora RLS. Trocadas por
   `is_admin()` / `can_operate()`, e a varredura materializa a lista de alvos
   antes de alterar — iterar `pg_policies` enquanto se altera `pg_policy` não
   aplica nada e ainda reporta sucesso.
2. **`department_connections` tinha RLS ligado e nenhuma policy.** O filtro de
   "Número" do inbox e a tela de Setores viriam sempre vazios. Leitura liberada,
   escrita admin, e `api_key_encrypted` revogada da leitura do browser.

### Transferência de conversa

Antes só existia "Atribuído a", que troca a pessoa mas não o departamento — e
`department_id` é o que as policies leem. Passar uma conversa do RH para o
Departamento Pessoal era impossível pela tela.

`whatsapp_hub.transfer_conversation(conversa, pessoa, setor, motivo)` faz os
dois, numa transação com o registro:

- **Para um setor** → entra na fila, sem dono, para o supervisor distribuir.
- **Para uma pessoa** → vai junto o departamento dela; do contrário a conversa
  ficaria com um dono que as policies do próprio setor dele não deixam ver.
- **`connection_id` não muda.** O contato escreveu para um número específico e a
  resposta continua saindo por ele. Trocar de setor muda quem atende, não por
  onde o cliente falou.
- **`ai_paused = true`** — quem transfere está entregando para um humano.
- Deixa **nota privada** na thread com origem, destino e motivo. Sem isso a
  conversa chega no destinatário sem contexto nenhum.
- Recusa com mensagem clara quando o contato já tem conversa no setor de
  destino, em vez de estourar a `UNIQUE (contact_id, department_id)` crua.

Verificado em produção: transferida para a pessoa da Portaria 1 (foi para
Segurança, atribuída, IA pausada, nota gravada), devolvida para a fila do
Departamento Pessoal, e os rastros de teste removidos.

### Inbox — filas implementadas (`f0683c6`)

Coluna esquerda com as dez filas (Todos · Não atribuídos · Meus atendimentos ·
Aguardando · Em atendimento · Aguardando cliente · Encerrados · Prioridade alta
· Não lidos · Favoritos), contadores que batem com a lista, e filtros por
atendente, equipe, marcador, canal e número. Prioridade e favorito viraram
colunas — favorito é por usuário (`conversation_favorites`), não da instalação.
