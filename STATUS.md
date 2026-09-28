# MegaCRM — Estado Atual

> **Este é o único lugar pra perguntar "onde estamos".** Atualize este
> arquivo a cada entrega relevante — não crie outro arquivo de status
> paralelo. Arquitetura e regras de código ficam em `CLAUDE.md`; backlog de
> bugs/pendências fica em `ISSUES.md`; histórico narrativo antigo (antes de
> 21/09/2026) fica em `PLANEJAMENTO.md`, que não é mais atualizado.

**Repositório:** `rodneicalixto-prog/megacrm` — **ativo**, branch `main`.
**Última atualização deste arquivo:** 2026-09-28.

---

## Correção de rumo — 28/09/2026

O `README.md` teve, desde 18/09/2026, um banner dizendo que este repositório
estava **arquivado** em favor de um hub "SmartZap", por suposta redundância
com `super_calixto_crm`. Isso estava **errado** — são projetos diferentes —
e o próprio desenvolvimento continuou normalmente depois desse commit (dois
épicos inteiros, ver abaixo). O banner foi removido do README. Se você (ou
um agente) encontrar essa menção em algum lugar, ignore — este repo segue
ativo.

---

## Épicos de modernização

| # | Épico | Status |
|---|---|---|
| 1 | Frontend Modernization (tokens de cor, componentes, Departments/Setor redesign) | ✅ Completo — 19/09/2026 |
| 2 | Backend Improvements (streaming IA/SSE, React Query, CSP/CORS, rate limit webhooks) | ✅ Completo — 21/09/2026 |
| 3 | Debt & Dependencies (lint, zod, deps vulneráveis, doc Zernio/Recall) | ⏳ Não iniciado — opcional, sem data |

Detalhe tarefa a tarefa: ver `PLANNING-CONSOLIDADO-2026-09-21.md` (congelado
nessa data, não atualizar — quando os épicos mudarem, atualize esta tabela
aqui em vez disso).

**TypeCheck / Lint / Tests / Build:** limpos na última rodada (21/09).

## Infraestrutura

| | |
|---|---|
| Deploy | Vercel, `main` → produção, auto-deploy |
| Banco | Supabase `lstbxeaasyysboavdati` |
| WhatsApp | Zernio (oficial) + Evolution API v2 (self-hosted) coexistindo |
| CI | lint · typecheck · SQL · build · testes |

## Última correção relevante

`fix(setup): bootstrap fecha migration sem ponto e vírgula e aumenta
maxDuration` (`2515cfc`, 21/09) — fechou o bug do wizard `/setup` travando no
passo Bootstrap. Ver `ISSUES.md` para o histórico completo do diagnóstico.

## Pendências abertas conhecidas

- Épico 3 (debt) não iniciado — ver tabela acima.
- ~60 branches remotas acumuladas no GitHub (codex/*, claude/*, dependabot/*,
  features soltas, `test-lockfile-fix`) — nenhuma auditada nesta rodada;
  candidatas a limpeza numa sessão futura, mas isso é ação de `@devops`
  (push/branch), não decidido aqui.
- `ISSUES.md` tem mudança não commitada em `ISSUES.md` e
  `supabase/functions/redirect-tracker/index.ts` no working tree — revisar
  antes do próximo commit.
- Ver `ISSUES.md` para a lista completa de issues abertas/fechadas.

## Mapa de documentos deste repo

| Arquivo | Papel |
|---|---|
| `CLAUDE.md` | Fonte de verdade de arquitetura: stack, schema, RLS, Edge Functions, convenções, design system |
| `AGENTS.md` | Só aponta pra `CLAUDE.md` — não duplicar conteúdo aqui |
| `STATUS.md` (este arquivo) | Estado atual — único lugar de "onde estamos" |
| `PRD.md` | Por que o produto existe, pra quem, o que cada feature entrega — várias seções `[A PREENCHER]`, ver o próprio arquivo |
| `APP-FLOW.md` | Inventário de telas, jornadas, navegação — gerado das rotas reais, algumas lacunas marcadas `[A PREENCHER]` |
| `ISSUES.md` | Backlog de bugs/pendências, formato issue-a-issue |
| `DESIGN.md` | Design system extraído do código real (cores, tipografia, componentes) |
| `PLANEJAMENTO.md` | Log histórico até 03/09/2026 — não editar, não é o estado atual |
| `PLANNING-CONSOLIDADO-2026-09-21.md` | Snapshot congelado dos épicos em 21/09 — detalhe tarefa a tarefa; não editar, dados vivos ficam neste `STATUS.md` |
| `CHANGELOG.md` | Changelog de release |
| `README.md` | Setup pra quem instala/roda o app |
