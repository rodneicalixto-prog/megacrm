# MegaCRM — Avaliação do Repositório e Planejamento

> Avaliação feita em 2026-08-08 sobre o estado atual de `rodneicalixto-prog/megacrm`
> (commit `f01d683`, branch `main`).

---

## 1. Veredito em uma linha

**O produto é sólido; o repositório não existe.** Há ~35 mil linhas de uma
aplicação bem construída, com TypeScript strict, build limpo e documentação
séria — tudo lacrado dentro de um arquivo `.zip` de 1,2 MB. Nada disso está
versionado. Enquanto o ZIP não for descompactado no Git, o repositório não
entrega nenhuma das funções pelas quais existe.

---

## 2. Estado do Git

| Item | Situação |
|---|---|
| Commits | 1 — `f01d683 "Add files via upload"` |
| Arquivos versionados | 1 — `8dbedacd-…-megacrm.zip` |
| Branches | `main`, `claude/git-evaluation-planning-qaovby` |
| Histórico útil | Nenhum |

### O que se perde na prática

- **Sem diff e sem blame.** Impossível saber o que mudou, quando, ou por quê.
- **Sem code review.** Nenhum PR pode ser aberto sobre um binário.
- **CI decorativa.** Existe um `.github/workflows/ci.yml` — *dentro do ZIP*.
  O GitHub nunca o enxerga, então nunca roda.
- **Sem rollback.** Um erro em produção não tem ponto de retorno.
- **Sem colaboração.** Duas pessoas editando = dois ZIPs incompatíveis.
- O próprio `ISSUES.md` do projeto admite isso: *"Placeholder de tracking
  enquanto o repo não está em um remoto GitHub."* Agora está — mas o
  conteúdo continua fora dele.

### Lixo carregado dentro do ZIP

O ZIP preservou exatamente o que o `.gitignore` do projeto manda excluir:

- `__MACOSX/` — 71 arquivos de metadado do macOS
- 4 × `.DS_Store`
- `dist/` — 1,9 MB de build já compilado
- `tsconfig.app.tsbuildinfo`, `tsconfig.node.tsbuildinfo` — cache de build
- `supabase/.temp/linked-project.json` — **vaza o project ref
  (`tlcnlqfcyduxrumrjwma`) e o organization id do Supabase**

Nenhum segredo real (chave de API, token, service role) foi encontrado na
varredura. O vazamento acima é de identificadores, não de credenciais — baixa
severidade, mas não deveria estar lá.

---

## 3. Estado do produto

**MegaCRM / `whatsapp-hub`** — plataforma self-hosted de automação WhatsApp
para uma organização: templates assistidos por IA, campanhas em massa com
tier da Meta, inbox em tempo real com handoff IA↔humano, RAG, funil de vendas,
atribuição de UTM e dashboard.

### Stack

- **Front:** React 18 · Vite · TypeScript · Tailwind v4 · shadcn/ui
- **Back:** Supabase (Postgres, Auth, Realtime, Edge Functions, Storage,
  pgvector, `pg_cron`, `pg_net`)
- **WhatsApp:** Zernio (relay para Meta Cloud API) + Uazapi
- **Deploy:** Vercel (SPA + 7 serverless functions)

### Dimensão

| Área | Linhas | Arquivos |
|---|---:|---:|
| `src/` (frontend) | 21.173 | 120 |
| `supabase/migrations/` | 6.263 | 67 |
| `supabase/functions/` | 5.848 | 23 funções |
| `api/` (serverless Vercel) | 1.215 | 7 |
| `tests/` | 718 | 9 specs |

### O que está genuinamente bom

- ✅ **Build passa limpo** — `npm run build` em 9,4 s, sem erro nem warning.
- ✅ **Disciplina de tipos** — `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch` ligados. **Apenas 2 `any` em toda a base.** Isso
  é raro e vale registrar.
- ✅ **Segurança bem pensada** — webhooks validam HMAC-SHA256 com comparação
  *timing-safe*; `requireAdmin` / `requireCaller` / `requireServiceRole`
  padronizados nas Edge Functions; credenciais de aplicação criptografadas em
  `app_settings` com `CRYPTO_KEY` (não em `.env`); ~130 policies RLS por role.
- ✅ **Documentação acima da média** — `AGENTS.md` (23 KB), `CLAUDE.md`
  (26,6 KB), `README`, `INSTALL`, `CHANGELOG` no padrão Keep a Changelog,
  `CONTRIBUTING`, além de `src/customizations/` como zona segura para forks
  locais. Alguém pensou em manutenção de longo prazo.

---

## 4. Riscos técnicos identificados

Ordenados por severidade.

### 🔴 R1 — `api/` está fora do type-check

`tsconfig.app.json` declara `"include": ["src"]`. Os 7 serverless da Vercel
**nunca passam pelo compilador**, nem no build nem na CI.

Confirmado na prática:

```
api/bootstrap.ts(536,24): error TS18048: 'body' is possibly 'undefined'.
```

É exatamente a issue já documentada em `ISSUES.md` — aberta desde então. O
arquivo em questão é o que roda migrations e deploya Edge Functions no
`/setup`: o caminho mais crítico do produto inteiro.

### 🔴 R2 — CI que não verifica nada

O workflow atual roda:

```yaml
- run: npm run lint --if-present   # o script "lint" NÃO EXISTE → no-op
- run: npm run build
```

Não roda `tsc` sobre `api/`. Não roda os testes Playwright. Não roda
`npm run validate:sql`, que já existe no `package.json`. Uma CI que só
compila o frontend dá falsa sensação de proteção.

### 🟠 R3 — Cobertura de teste concentrada no lugar errado

As 9 specs cobrem **apenas o wizard `/setup`**, com shim offline. Ficam sem
nenhum teste: inbox, disparo de campanhas, funil, agente de IA, webhooks de
entrada, RAG, atribuição de UTM. Ou seja: 100% do risco de negócio está
descoberto, e 100% do esforço de teste está no caminho que roda uma vez por
instalação.

### 🟠 R4 — Vulnerabilidades de dependência

`npm audit`: **5 vulnerabilidades (3 moderate, 2 high)**.

| Pacote | Severidade | Fix |
|---|---|---|
| `ws` | high | `npm audit fix` resolve |
| `react-router-dom` / `@remix-run/router` | moderate | `npm audit fix` resolve |
| `xlsx@0.18.5` | **high** (Prototype Pollution + ReDoS) | **sem fix no npm** |

O `xlsx` é o caso sério: a SheetJS abandonou o registry npm, então a versão
publicada nunca será corrigida. Ele é usado na importação de contatos — que
recebe arquivo de terceiro. Precisa migrar para o tarball oficial da SheetJS
ou trocar por `exceljs`.

### 🟡 R5 — Peso do bundle

`index` 449 KB + `PieChart` (recharts) 374 KB + `xlsx` 332 KB. Já há
code-splitting por rota, mas recharts e xlsx sozinhos passam de 700 KB. Ambos
são candidatos naturais a import dinâmico sob demanda.

### 🟡 R6 — 67 migrations lineares para chegar ao schema atual

A cadeia inclui `drop_super_admin`, `drop_multitenant`, `drop_onboarding` —
migrations que desfazem arquitetura antiga. Toda instalação nova hoje aplica
67 migrations, incluindo criar e depois destruir o modelo multi-tenant. Isso
alonga o `/setup` e multiplica a superfície de falha em ambiente de cliente.

### 🟡 R7 — Divergência entre documentação e código

O `README` e o `AGENTS.md` documentam **Zernio** como caminho único. O código
suporta **dois provedores** (Zernio oficial e Uazapi não-oficial), com cards
próprios no wizard e providers separados em `_shared/whatsapp/`. O `AGENTS.md`
ainda cita `META_*` e `LLM_PROVIDER` como env vars, que o `README` diz
explicitamente que não existem mais.

### 🟡 R8 — Endpoints públicos sem rate limit

`ingest-lead` e `redirect-tracker` rodam com `--no-verify-jwt` e CORS aberto,
por desenho (são chamados da landing do cliente). Não há throttling nem
proteção contra flood — um bot pode inundar o CRM de leads falsos.

---

## 5. Planejamento

### Fase 0 — Destravar o Git ⏱️ ~1 hora · 🔴 bloqueia todo o resto

1. Descompactar o ZIP na raiz do repositório.
2. Remover o lixo antes do commit: `__MACOSX/`, `.DS_Store`, `dist/`,
   `*.tsbuildinfo`, `supabase/.temp/`.
3. Confirmar que o `.gitignore` do projeto (já correto) passa a valer.
4. Commit inicial da árvore de código real.
5. Deletar o `.zip` do versionamento.
6. Confirmar que `.github/workflows/ci.yml` passa a ser reconhecido pelo GitHub.

**Resultado:** diff, blame, PR, review, CI e rollback voltam a funcionar.
Sem esta fase, nenhuma outra é executável de forma sustentável.

### Fase 1 — CI que realmente verifica ⏱️ 1–2 dias

1. Criar `tsconfig.api.json` cobrindo `api/` e corrigir o `TS18048` de
   `api/bootstrap.ts:536` (guard explícito `if (!body) throw …`). Fecha R1 e a
   issue aberta do `ISSUES.md`.
2. Adicionar ESLint + o script `lint` que a CI já tenta chamar.
3. Reescrever o workflow: `lint` → `tsc` (src **e** api) → `validate:sql` →
   `build` → `playwright test`.
4. Proteger a branch `main`: exigir CI verde e review para merge.
5. Migrar as entradas de `ISSUES.md` para issues reais do GitHub.

### Fase 2 — Segurança e dependências ⏱️ 2–3 dias

1. `npm audit fix` — resolve `ws` e `react-router-dom`.
2. Substituir `xlsx@0.18.5`: migrar para o tarball oficial da SheetJS
   (`https://cdn.sheetjs.com/`) ou trocar por `exceljs`. Decidir com base no
   uso real em `ImportContactsDialog.tsx`.
3. Adicionar rate limit em `ingest-lead` e `redirect-tracker` (R8).
4. Ligar Dependabot ou Renovate para não reacumular dívida.
5. Rodar `run_secret_scanning` no repositório depois da Fase 0.

### Fase 3 — Testar onde está o risco ⏱️ 1–2 semanas

Ordem por valor decrescente:

1. **Webhooks de entrada** (`zernio-webhook`, `whatsapp-inbound`) — validação
   de HMAC, dedup por `wamid`, payloads malformados.
2. **Dispatcher de campanha** — respeito ao tier da Meta, batching,
   idempotência, retry.
3. **Agente de IA** (`process-ai-message`) — handoff IA↔humano, movimentação
   de estágio, horário comercial.
4. **Funil / CRM** — transições de estágio, ganho/perda, predições.
5. Introduzir Vitest para teste unitário das funções puras
   (`lib/phone.ts`, `lib/utm.ts`, `lib/nextAction.ts`, `lib/dealOrigin.ts`) —
   retorno alto e barato.

### Fase 4 — Consolidação técnica ⏱️ 2–3 semanas

1. **Baseline de migrations (R6):** gerar um `_baseline.sql` do schema atual e
   arquivar as 67 migrations históricas. Instalações novas passam a aplicar 1
   arquivo; instalações existentes seguem pela cadeia antiga.
2. **Reconciliar documentação (R7):** decidir se Uazapi é oficialmente
   suportado ou experimental, e refletir isso no `README` e no `AGENTS.md`.
   Remover as referências mortas a `META_*` e `LLM_PROVIDER`.
3. **Bundle (R5):** import dinâmico de `xlsx` (só no fluxo de importação) e de
   recharts (só nos dashboards).
4. Quebrar os arquivos maiores: `SetupPage.tsx` (896 linhas),
   `DealDrawer.tsx` (710), `process-ai-message/index.ts` (709).

### Fase 5 — Produto ⏱️ contínuo

Só faz sentido depois da Fase 1. Com CI verde e review funcionando, o
desenvolvimento de features passa a ter rede de proteção. Pauta sugerida para
priorização: multi-número, relatórios exportáveis, API pública, i18n (o v1 é
PT-BR fixo por decisão explícita).

---

## 6. Sequência recomendada

```
Fase 0  ██                                    ~1h    🔴 bloqueante
Fase 1  ████████                              1-2d   🔴 alta
Fase 2  ████████████                          2-3d   🟠 alta
Fase 3  ████████████████████████████████      1-2sem 🟠 média
Fase 4  ████████████████████████████████████  2-3sem 🟡 média
Fase 5  ──────────────────────────────────►   contínuo
```

Fases 0 → 1 → 2 são sequenciais e não devem ser puladas. Fases 3 e 4 podem
correr em paralelo com desenvolvimento de produto, desde que a Fase 1 esteja
concluída.

---

## 7. As três coisas que importam agora

1. **Descompactar o ZIP.** Sem isso, o repositório é um arquivo morto.
2. **Colocar `api/` no type-check.** Há um erro real, conhecido e não
   corrigido no caminho mais crítico do produto.
3. **Resolver o `xlsx`.** É uma vulnerabilidade *high* sem patch, num fluxo
   que consome arquivo enviado por terceiro.
