# MegaCRM — PRD e Estado Operacional

> Avaliação original: 2026-08-08, sobre o commit `f01d683`.
> Última atualização: 2026-08-21, branch `main`, commit operacional `34e4429`.

---

## 1. Onde estamos

| | |
|---|---|
| **Repositório** | ✅ código versionado e sincronizado com `origin/main` |
| **CI** | ✅ lint · typecheck · SQL · build · testes |
| **Deploy Vercel** | ✅ `megacrm`, produção ativa em `megacrm-seven-smoky.vercel.app`, 11 serverless |
| **Testes** | ✅ 184 unitários (Vitest) + 9 E2E · SQL, build e tipos em toda a base |
| **Banco Supabase** | ✅ `lstbxeaasyysboavdati` — 93 migrations, 22 Edge Functions |
| **Rota WhatsApp** | ✅ Evolution API v2 · texto, áudio, vídeo, documentos e roteamento por linha/departamento |

O diagnóstico que abriu este documento — *"o produto é sólido; o repositório
não existe"* — está resolvido. As Fases 0 a 3 foram executadas, produção e banco
estão ligados. O código e a infraestrutura estão prontos para testes reais; a
ativação operacional depende da validação do primeiro login e das credenciais da
instância Evolution.

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
| `src/` (frontend) | 23.041 | 142 |
| `supabase/migrations/` | 7.371 | 93 |
| `supabase/functions/` | 6.118 | 22 funções + módulos compartilhados |
| `api/` (serverless Vercel) | 1.629 | 11 |
| `tests/` | 2.300 | 9 specs E2E + 14 arquivos unitários (184 testes) |

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

O `npm audit` atual reporta **5 pacotes**: 2 high e 3 moderate. Nenhum bloqueia o
início do teste controlado, mas planilhas de origem desconhecida permanecem
proibidas até a substituição do parser vulnerável.

| Pacote | Severidade | Situação |
|---|---|---|
| `xlsx@0.18.5` | high | ⏳ aberto — risco ao processar planilhas não confiáveis; não há fix no npm |
| `vite` / `esbuild` | high / moderate | ⏳ aberto — superfície principal no servidor de desenvolvimento; upgrade é major |
| `react-router-dom` / `react-router` | moderate | ⏳ aberto — revisar junto da migração de router, sem atualização cega |

### 🟡 R5 — Peso do bundle

`index` 449 KB + `PieChart` (recharts) 374 KB + `xlsx` 332 KB. Há
code-splitting por rota, mas recharts e xlsx passam de 700 KB juntos. Candidatos
a import dinâmico.

### 🟡 R6 — 93 migrations lineares

A cadeia inclui `drop_super_admin`, `drop_multitenant`, `drop_onboarding` —
migrations que desfazem arquitetura antiga. Toda instalação nova cria e depois
destrói o modelo multi-tenant. Alonga o `/setup` e amplia a superfície de falha.

### ✅ R7 — Divergência doc/código — resolvido

A rota não-oficial passou de Uazapi para Evolution API v2 e o `README` agora
documenta as duas rotas corretamente. O `AGENTS.md` também registra que o
provider e as credenciais vêm de `public.app_settings`, não de env vars de
aplicação.

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

### 🟨 Fase 4 — Consolidação técnica — em andamento

1. **Baseline de migrations (R6)** — `_baseline.sql` do schema atual, arquivando
   as 89 históricas. Instalação nova passa a aplicar 1 arquivo.
2. ✅ **Documentação (R7)** — `AGENTS.md` alinhado ao cofre de credenciais;
   não apresenta `META_*` ou `LLM_PROVIDER` como variáveis de ambiente.
3. ✅ **Bundle (R5)** — `xlsx` passou a ser importado apenas quando uma
   planilha Excel é selecionada. Recharts saiu do dashboard operacional e as
   métricas de campanhas agora são carregadas somente ao abrir a aba Métricas.
4. 🟨 **Quebrar arquivos maiores** — componentes visuais e estado core do
   wizard foram separados, reduzindo `SetupPage.tsx` de 978 para 815 linhas.
   Os editores reutilizáveis do funil também saíram de `DealDrawer.tsx`, que
   caiu de 710 para 399 linhas. O movimento automático de leads foi isolado
   em `_shared/auto-move-lead.ts`, reduzindo `process-ai-message/index.ts` de
   600 para 496 linhas. As três etapas core do wizard vivem em
   `SetupCoreSteps.tsx`, e a etapa final de credenciais da aplicação em
   `ApplicationCredentialsStep.tsx`; `SetupPage.tsx` caiu de 815 para 536 linhas.

### 🟨 Fase 5 — Produto — em andamento

1. ✅ **Relatório operacional exportável** — o dashboard de atendimento pode
   ser filtrado por setor e gera CSV do recorte exibido, com indicadores da
   fila, carga por atendente, volume dos últimos sete dias e conversas paradas,
   neutralizando fórmulas vindas de dados de contato.
2. 🟨 **Multi-número** — Inbox e roteamento já distinguem linha por
   `connection_id`; o dashboard operacional agora também filtra por número e
   exporta o CSV desse recorte. A tela de Setores permite cadastrar e remover
   instâncias Evolution, vinculando cada linha à fila do setor ou a um cargo.
   O CRM agora cria/reconecta a instância, mostra o QR Code ou código de
   pareamento e registra o webhook sem expor a API key no navegador. O status
   conectado/offline é consultado server-side. URL e chave Evolution específicas por linha agora são opcionais,
   validadas por endpoint administrativo e armazenadas com a chave criptografada;
   quando omitidas, a linha continua herdando a credencial global.
3. ✅ **Inbox operacional** — área central ampliada, painel de contato sob
   demanda, tema claro/escuro, cards do dashboard navegáveis, encerramento e
   reabertura sem diálogo nativo, notificações agregadas por contato, resposta
   citada, reação, encaminhamento, presença de digitação e nota de voz via
   Evolution. Mensagens inbound de áudio sem URL pública são resolvidas pela
   API da instância e persistidas no histórico.
4. ⏳ **Próximas pautas** — grupos reais da Evolution, API pública e i18n. O
   v1 permanece PT-BR fixo. Grupos `@g.us` continuam bloqueados até o modelo
   persistir o `remoteJid` e garantir resposta no grupo, sem desviar mensagem
   para o telefone privado de um participante.

---

## 6. Decisões de produto tomadas no caminho

- **Agente de IA é opt-in.** O default era ligado, herdado de quando se assumia
  número comercial novo. Na rota não-oficial o número conectado costuma estar em
  uso — o agente respondia cliente antigo, fornecedor e conversa pessoal no
  primeiro minuto depois do setup. Ligar é um clique; desfazer um agente que já
  falou com 174 contatos, não. Migration `20260808140000`.

---

## 7. Pendências fora do código

1. **Validar o primeiro login no navegador.** A conta existe como `super_admin`,
   o e-mail está confirmado e o `site_url` aponta para a produção correta.
2. **Configurar a Evolution** no CRM: salvar URL e API key, criar a linha em
   Setores e escanear o QR Code exibido pelo próprio painel.
3. **Executar o teste real ponta a ponta** com uma linha controlada: entrada,
   roteamento, texto, áudio, vídeo, documento e resposta pela mesma instância.
4. **Configurar credenciais de IA/transcrição** somente quando esses recursos
   entrarem no roteiro de teste.
5. **Remover objetos legados sem uso** fora do schema `whatsapp_hub` após backup
   e autorização destrutiva explícita. Tomik não faz parte do produto atual.
6. **Substituir ou isolar `xlsx`** antes de aceitar planilhas não confiáveis.
7. **Revogar PATs e service roles expostos em conversas** e atualizar os
   ambientes protegidos de forma coordenada.
8. ~~**Religar RLS em `whatsapp_hub.tenants`, `tenant_settings`,
   `tenant_credentials` e `tenant_members`.**~~ — **resolvido em 21/08/2026**:
   migration `20260821150000_rls_legacy_tenant_tables.sql` religou RLS (zero
   policies — mesmo padrão de `public.app_settings`, só service role acessa)
   e revogou os grants de `anon`/`authenticated`, aplicada em produção
   (`lstbxeaasyysboavdati`). As tabelas continuam sem uso pelo produto atual;
   nenhuma delas foi removida.
9. ~~**Fase C do `docs/PLANO-HIERARQUIA.md` (visibilidade por departamento) —
   nunca implementada.**~~ — **parcialmente resolvida em 21/08/2026**:
   `conversations_select`/`messages_select` estavam `USING (true)` desde a
   remoção do multi-tenant — qualquer autenticado lia qualquer conversa,
   inclusive do departamento restrito "Administração Geral". Migration
   `20260821180000_conversations_department_rls.sql` reescreveu as 4 policies
   (`conversations_select/write`, `messages_select/write`) usando os helpers
   que já existiam prontos desde a fase de hierarquia
   (`current_user_department`, `department_is_restricted`,
   `sees_all_departments`, `is_super_admin`) — cada um só vê/edita o próprio
   departamento, e só `super_admin` vê o restrito. De brinde, corrigiu
   `conversations_write`/`messages_write`, que ainda filtravam
   `current_user_role() IN ('admin','operator')` — resíduo de antes da
   hierarquia que bloqueava `supervisor` e `super_admin` de escrever nessas
   tabelas via RLS (o frontend escreve direto nelas — pausar IA, marcar como
   lida, atribuir — não passa por Edge Function com service role).
   **Item 12 resolvido também em 21/08/2026** — migration
   `20260821190000_app_users_hide_super_admin.sql`: `app_users_self_select`
   comparava `current_user_role() = 'admin'` (literal), então nem o próprio
   `super_admin` via a lista de membros, só a própria linha — mesma classe de
   bug já corrigida várias vezes nesta rodada. Agora `super_admin` vê todo
   mundo, `admin` vê todo mundo **exceto** a linha do `super_admin`, e
   `supervisor`/`operator` continuam vendo só a própria linha (não
   ampliado — ver decisão em aberto abaixo).
   **Item da decisão de produto resolvido em 21/08/2026**: o usuário
   confirmou explicitamente que `operator` vê só o que foi atribuído a ele
   (`assigned_to = auth.uid()`), não o departamento inteiro — exatamente o
   desenho original do `docs/PLANO-HIERARQUIA.md` (seção 5). Migration
   `20260821200000_operator_assigned_only_visibility.sql` (aplicada em
   produção) reescreveu as mesmas 4 policies para separar `operator`
   (assigned-only) de `supervisor` (departamento inteiro, inalterado);
   `admin`/`super_admin` seguem com bypass total. `CLAUDE.md` já documentava
   esse recorte por role na seção "Auth & Roles" — o gap era só a policy.
   De brinde, o dropdown "Atribuído a" no painel de contato do Inbox
   (`ContactPanel.tsx`) agora fica desabilitado para `operator`: como ele só
   enxerga conversas já atribuídas a ele mesmo, qualquer tentativa de
   reatribuir para outra pessoa falharia silenciosamente no `WITH CHECK` da
   policy — a UI agora deixa isso explícito ("Só supervisor ou admin podem
   reatribuir a conversa.") em vez de deixar o operador escolher uma opção
   que sempre vai falhar.
   **Ainda em aberto, itens 10-11 e 14 do plano original:**
   - `contacts` e o funil (`deals`) não têm coluna `department_id` — precisa
     de decisão de modelo (um contato pode falar com mais de um
     departamento? é dono único ou N:N?) antes de qualquer RLS aí; hoje
     seguem `USING (true)`.
   - Teste com usuário de cada papel (item 14) não foi feito — hoje só existe
     1 `app_users` real em produção (`super_admin`), sem conta de
     supervisor/operator pra validar o recorte de verdade.
   - **Vendas & Recompra**: mantido por decisão do usuário (21/08/2026) — "vou
     usar em outra fase". Não é mais uma pendência a resolver nesta rodada;
     nenhuma remoção/alteração deve ser feita sem novo pedido explícito.

---

## 8. Estado operacional oficial (21/08/2026)

Esta seção substitui o retrato operacional de 10/08/2026, que apontava para
outro projeto Supabase e continha dados identificáveis de uma instalação
anterior. Esses dados não são requisitos do MegaCRM e não devem ser usados para
configurar o ambiente oficial.

### Infraestrutura oficial

| Item | Estado |
|---|---|
| Produção | `https://megacrm-seven-smoky.vercel.app` |
| GitHub | branch `main`, sincronizada com `origin/main` |
| Supabase | `lstbxeaasyysboavdati` |
| Schema do MegaCRM | `whatsapp_hub`, exposto na Data API |
| Banco | 93 migrations aplicadas e registradas |
| Edge Functions | 22 `ACTIVE`: 18 com JWT e 4 endpoints externos com controle próprio |
| Storage | buckets de branding, logos, knowledge, agent media e outbound media |
| Health check | `/api/health` retorna `200 {"ready":true}` |

O bundle de produção contém somente o project ref oficial; referências de
projetos anteriores não aparecem no artefato publicado. Tomik não integra o produto atual e nenhuma funcionalidade do MegaCRM
depende de objetos com esse nome.

### WhatsApp e Evolution

A rota não-oficial suportada é **Evolution API v2**. UAZAPI não faz parte da
arquitetura ativa. O que foi aproveitado foi a cobertura funcional, não o
provedor:

- entrada e saída de texto;
- áudio e transcrição quando a credencial de IA estiver configurada;
- imagem, vídeo e documentos via bucket de mídia de saída;
- roteamento por instância, departamento, fila e cargo;
- resposta pela mesma conexão que recebeu a conversa;
- fila ordenada e circular por departamento, restrita a `supervisor` e `operator`;
- linhas pessoais ligadas a cargo ocupado são atribuídas diretamente e não entram na fila;
- `super_admin` e `admin` podem responder diretamente, mas nunca são inseridos na fila;
- erros devolvidos pela Evolution aparecem no Inbox em vez de serem ignorados;
- triggers inbound e handoff sem referências residuais a `tenant_id`;
- falhas de persistência liberam a deduplicação e retornam erro para permitir retry;
- a instância global configurada usa o setor padrão durante a transição, enquanto instâncias desconhecidas são bloqueadas;
- webhook Evolution protegido por segredo aleatório armazenado cifrado;
- geração da URL segura pelo endpoint administrativo, sem segredo hardcoded.

### Inbox, atendimento e notificações

- finalizar uma conversa define `status = closed`, `closed_at` e
  `unread_count = 0`; trigger no banco impede que uma conversa encerrada volte
  a ficar não lida;
- notificações pendentes da conversa são resolvidas no encerramento e saem da
  interface ao serem visualizadas;
- o sino mostra somente pendências, uma entrada agregada por contato, separada
  nos grupos visuais **Mensagens** e **Aguardando atendimento**;
- resposta citada, reação, encaminhamento e presença de digitação usam os
  endpoints próprios da Evolution;
- gravação pelo microfone é enviada como nota de voz (`ptt`) e não como anexo
  genérico;
- áudio recebido é recuperado pela Evolution quando o webhook não entrega uma
  URL reproduzível;
- conversas encerradas são removidas imediatamente do painel ativo, com opção
  reversível de reabertura;
- grupos reais de WhatsApp ainda não entram no CRM: payloads `@g.us` são
  ignorados deliberadamente até existir identidade de grupo e roteamento de
  saída seguros.

O webhook público não confia apenas em `verify_jwt=false`: ele exige o token
específico da Evolution antes de processar o payload. Funções internas e ações
de usuário continuam protegidas pelo verificador JWT da plataforma.

### Auth e primeiro acesso

O primeiro usuário foi criado e recebeu `super_admin` tanto em `auth.users`
quanto em `whatsapp_hub.app_users`. O vínculo está aceito, a identidade de
e-mail existe e a confirmação já foi registrada pelo Supabase Auth.

Durante o diagnóstico, o Supabase Auth ainda apontava para
`http://localhost:3000`; o `site_url` e a allow-list foram corrigidos para o
domínio oficial. O próximo passo é validar o login no navegador e a abertura do
painel com as policies do papel `super_admin`.

### Evidências de validação

- `npm run typecheck`: aprovado;
- `npm run test:unit`: 14 arquivos, 184 testes aprovados;
- `npm run validate:sql`: 93 arquivos, 1.039 statements aprovados;
- retry do bootstrap: histórico canônico reconciliado com `_bootstrap_state`,
  comprovado com 89/89 checkpoints sem reaplicar migrations;
- `npm run build`: aprovado localmente e na Vercel;
- deploy automático do GitHub: `READY`, sem erro TypeScript;
- função autenticada sem JWT: `401`;
- Data API com service role e schema `whatsapp_hub`: `200`;
- acesso anônimo direto a `contacts`: bloqueado por permissão/RLS;
- RPC pública `signup_status`: `first_user_pending=true` antes da criação do
  owner;
- fila por departamento e RPC de distribuição verificadas no banco oficial;
- verificação de integridade da fila: zero `admin` ou `super_admin` inseridos.
- verificação pós-migration: zero conversas encerradas com `unread_count > 0`
  e zero notificações não lidas vinculadas a conversas encerradas.

### Critério para liberar testes reais

A infraestrutura está pronta. A instalação passa a **apta para teste real ponta
a ponta** quando todos os itens abaixo forem concluídos:

1. owner entra no painel com o e-mail já confirmado;
2. credenciais da Evolution são salvas pelo painel;
3. linha é criada, QR Code é escaneado e o webhook seguro é registrado automaticamente;
4. uma mensagem controlada percorre entrada, roteamento e resposta;
5. áudio, vídeo e documento são verificados sem dados pessoais reais;
6. logs e registros sintéticos do teste são revisados e removidos.

### Proteção de dados

- Não misturar schemas, tabelas ou registros de outras empresas.
- Não copiar dados da instalação antiga para `whatsapp_hub`.
- Usar contatos sintéticos ou autorizados durante homologação.
- Service role, PAT, API keys e segredo do webhook nunca entram no Git.
- Toda remoção de objeto legado exige inventário, backup e confirmação explícita.

---

## 9. Rodada Agosto/2026 — avaliação do pacote de atualização Agentise

Um documento de atualização genérico da Agentise (`ATUALIZACAO-AGOSTO-2026.md`)
chegou propondo 10 blocos de feature, assumindo que o repo ainda estava perto
da versão "vanilla" de julho/2026. Não estava — divergiu em pontos estruturais
(departamentos + Evolution API v2 + multi-LLM, em vez de organizações
multi-tenant + Zernio/UAZAPI + LLM único). Cada bloco foi classificado antes de
qualquer código:

### Trazido nesta rodada (ver `CHANGELOG.md` 1.1.0)

Export CSV + seletor de página em Contatos; separadores de data no Inbox;
sidebar recolhível; avatares de iniciais; banner de credenciais faltantes;
arquivar/paginar/ordenar no Funil + temperatura por resultado; consultas
`.in()` fatiadas em lotes de 100; IA entende imagem + fallback de OCR de PDF +
erros reais na Base de Conhecimento.

### Descartado — conflito de arquitetura

- **Multi-tenancy por organização.** O modelo de departamentos foi construído
  deliberadamente para **uma** organização com estrutura interna — introduzir
  `org_id` em ~45 tabelas não é aditivo, é trocar o modelo de isolamento por
  outro incompatível.
- **Canal UAZAPI.** O projeto já migrou de UAZAPI para Evolution API v2
  (ver Fase "Fora do plano — rota Evolution API" acima); reintroduzir UAZAPI
  seria regressão de uma decisão já tomada.
- **Seletor de LLM removido (OpenAI-only).** Este projeto já suporta
  OpenAI/Claude/Gemini — mais completo que o proposto, mantido como está.
- **Custos de venda / faturamento líquido no Dashboard.** O módulo de Vendas &
  Recompra está sendo removido do projeto (decisão tomada em paralelo a esta
  rodada); não faz sentido adicionar métrica financeira a um módulo que sai.

### Decisões de produto adiadas (não implementadas, precisam de resposta antes)

- ~~**Round-robin só entre online**, no auto-assign de handoff
  (`lead_assignment_queue`).~~ — **resolvido em 21/08/2026, em duas
  passadas**. A primeira (`20260821151000_assignment_queue_online_only.sql`)
  filtrou `au.is_online = true`, mas nada no sistema jamais gravava esse
  valor como `true` — achado do code review completo do mesmo dia, que
  descobriu a regressão em produção poucas horas depois de aplicada: o
  round-robin nunca atribuía ninguém, nem com a equipe inteira logada. A
  segunda passada (`20260821160000_presence_and_assignment_fallback.sql`)
  corrigiu de verdade: RPC `set_own_presence()` + heartbeat de 45s em
  `AppUserProvider.tsx` gravam presença real; "online" passou a exigir
  `is_online = true` **e** `last_seen_at` recente (2min), pra uma aba
  fechada sem aviso expirar sozinha; e, se ninguém do setor estiver
  recentemente online, a função cai pro round-robin puro em vez de retornar
  `NULL` — uma conversa nunca fica sem responsável só por falta de presença.
  De brinde, fechou um vetor de auto-promoção de privilégio que a policy de
  presença já expunha em produção antes desta rodada: `app_users_self_presence_update`
  permitia `UPDATE` na própria linha sem checar qual coluna mudava, então
  qualquer usuário autenticado já podia gravar `role = 'admin'` direto pela
  tabela, client-side. Um trigger de guarda agora restringe o self-update a
  `is_online`/`last_seen_at`.
- **Variáveis por destinatário em campanhas.** Removidas deliberadamente do
  editor de templates (`TemplateFormDialog.tsx`: "Variáveis não são
  suportadas"). Reintroduzir é decisão de produto, não bug fix.
- **Automações de funil por gatilho** (módulo mais amplo que o
  auto-move-lead + follow-up rules já existentes) — escopo novo, não
  avaliado nesta rodada.

### Execução

Implementado por 6 agentes em paralelo, cada um em worktree isolado sem
sobreposição de arquivos, depois mesclados manualmente com `npm run
validate:sql` + `npx tsc -b --noEmit` + `npm run build` + `npm run lint` +
`npx vitest run` rodando limpo no conjunto final.

**Migrations e Edge Functions aplicadas em produção em 2026-08-21**, depois
que o MCP do Supabase foi reconectado na conta certa. As duas novas
(`20260811140000_deal_archive_and_temperature.sql`,
`20260812120000_knowledge_error_message.sql`) foram checadas contra o
schema real antes de aplicar (sem coluna/função/trigger/índice
conflitante) e aplicadas via `apply_migration`. `process-ai-message` e
`process-knowledge` foram redeployados com o código desta rodada,
incluindo toda a árvore de dependências `_shared/*`; conteúdo publicado
conferido de volta contra o repo.

Merge para `main` feito em 2026-08-21, resolvendo conflito real com o
trabalho paralelo que também estava em andamento em `main` (filas de
round-robin, ações de mensagem no Inbox, correções de trigger inbound) —
reconciliado arquivo a arquivo, sem descartar nenhum dos dois lados.

**Segunda rodada, mesma data (21/08/2026) — as 3 pendências finais desta fase
foram resolvidas**, a pedido explícito do usuário:

1. RLS religado nas 4 tabelas legadas de tenant (item 8 da seção 7, acima).
2. Round-robin de handoff só entre online (item da seção "Decisões de
   produto adiadas", acima).
3. Gap de retrigger da IA em áudio corrigido: `transcribe-audio` agora
   invoca `process-ai-message` diretamente após gravar a transcrição com
   sucesso (`fetch` direto para `${SUPABASE_URL}/functions/v1/process-ai-message`
   com a service role key, só no caminho de sucesso); `process-ai-message`
   passou a tratar `content_type='audio'` com transcrição como texto (exceto
   quando `content` ainda é o marcador de falha de transcrição).

Migrations `20260821150000_rls_legacy_tenant_tables.sql` e
`20260821151000_assignment_queue_online_only.sql` aplicadas em produção via
`apply_migration`; `transcribe-audio` (v6) e `process-ai-message` (v7)
redeployados com a árvore `_shared/*` completa, conteúdo conferido de volta
contra o repo. Validação local antes do deploy: `npm run typecheck`,
`npm run validate:sql`, `npm run lint` (0 erros, só os warnings
pré-existentes de `react-hooks/set-state-in-effect`), `npm run build` e
`npm run test:unit` (184/184).

**Terceira rodada, mesma data (21/08/2026) — code review completo do
projeto** (3 revisores em paralelo, só leitura: backend/Supabase, frontend,
docs/deps/testes), relatório publicado como Artifact pro usuário decidir o
que entrava antes de qualquer execução. Aprovado com "prossiga com todas as
ações necessárias"; itens executados:

1. **Regressão crítica do round-robin** — ver correção acima nesta seção.
2. `useContacts.ts`: fatiadas as duas buscas de tags/deals da página e o
   delete em massa que tinham escapado da rodada anterior de chunking.
3. `useMessages.ts`: guarda contra race condition ao trocar de conversa
   rápido (resposta antiga podia sobrescrever a conversa nova).
4. `ImportContactsDialog.tsx`: lotes de leitura `.in()` reduzidos de 500
   para 100 (upsert continua em 500 — é body de POST, não filtro de URL).
5. `CLAUDE.md`/`AGENTS.md`: corrigido o drift que o code review encontrou
   (enum de roles, lista de Edge Functions, jobs `pg_cron`, estrutura de
   pastas, `templates.category`, claim de "dark mode only" que não é mais
   verdade). `AGENTS.md` parou de duplicar conteúdo — hoje aponta pra
   `CLAUDE.md` como fonte única, já que a duplicação foi a causa raiz do
   drift.
6. Desagendados 3 jobs `pg_cron` órfãos/indevidos: `wh-check-template-status`
   (mirava função removida, gerando 404 a cada 5min havia meses) e os dois
   crons diários de recompra (módulo saindo do produto, mas ainda podendo
   disparar mensagens reais).

Achados do relatório **não** executados nesta rodada, por exigirem decisão
de produto em vez de correção mecânica: `UtmChannelMapEditor.tsx` sem rota
que o monte (parece wiring esquecido, não dead code); zero cobertura de
teste em Funil e Base de Conhecimento; `useDashboardPrefs.ts`/
`useForecast.ts` prontos mas nunca ligados na UI. Ficam registrados aqui
para retomar quando houver decisão sobre cada um.

Migrations desta rodada: `20260821160000_presence_and_assignment_fallback.sql`,
`20260821170000_unschedule_stale_crons.sql`, ambas aplicadas em produção via
`apply_migration` e confirmadas (funções/triggers criados, cron jobs
removidos — checado via `execute_sql`). Validação local: `npm run
typecheck`, `npx tsc -b --noEmit`, `npm run lint` (0 erros), `npm run build`,
`npm run test:unit` (184/184), `npm run validate:sql` (99 arquivos).

**Quarta rodada, mesma data (21/08/2026) — decisões de produto do usuário
sobre os itens deixados em aberto acima:**

1. **Funil ilimitado** — usuário reportou em uso real que "pode criar funis
   de acordo com a necessidade" tinha parado de funcionar. Era o mesmo bug
   de gate `adminOnly` no botão "Gerenciar funis" (ver item 9 acima e
   `CHANGELOG.md`) — RLS e UI já suportavam sem limite, só o botão estava
   escondido pra `supervisor`/`operator`. Confirmado como necessário agora
   e já resolvido/deployado.
2. **Vendas & Recompra** — usuário decidiu explicitamente manter como está:
   "vou usar em outra fase". Deixa de ser pendência; nenhuma remoção ou
   alteração deve ser feita sem novo pedido.
3. **Escopo de visibilidade do operador** — decisão pendente desde a
   Terceira rodada (item 9 acima), resolvida via pergunta direta ao
   usuário: `operator` vê só o atribuído a ele. Migration
   `20260821200000_operator_assigned_only_visibility.sql` aplicada em
   produção; `ContactPanel.tsx` ganhou gate no dropdown de reatribuição pra
   `operator` (evita tentar uma ação que a RLS sempre rejeitaria).

Validação local desta rodada: `npm run validate:sql` (102 arquivos),
`npx tsc -b --noEmit` (0 erros), `npm run lint` (0 erros, mesmos 68 warnings
pré-existentes), `npm run build`, `npm run test:unit` (184/184). Migration
aplicada em produção via `apply_migration` e conferida via `execute_sql`
contra `pg_policy`.
