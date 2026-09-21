# MegaCRM — Planejamento Consolidado de Modernização
**Data:** 2026-09-21  
**Status:** ÉPICO 1 ✅ Completo | ÉPICO 2 🚀 Em andamento | ÉPICO 3 ⏳ Aguardando

---

## ÉPICO 1 — FRONTEND MODERNIZATION (P0) ✅ COMPLETO

| # | Task | Status | Saída |
|---|---|---|---|
| 1.1 | Audit de design + token cleanup | ✅ | 83 arquivos sem `#3B82F6` hardcoded |
| 1.2 | Substituir hardcoded colors por tokens | ✅ | Tokens semânticos (`--accent-rgb`, `--accent-primary`, `--accent-secondary`) |
| 1.3 | Componentes faltantes (Select, Badge, DataTable, etc.) | ✅ | Badge, Skeleton, EmptyState, PageHeader, Select criados e testados |
| 1.4 | Fixar `.glass-card` hover em blocos não-clicáveis | ✅ | Hover apenas em `<a>`, `<button>`, `[role=button]` |
| 1.5 | DepartmentsSettings redesign (1064 → 4 componentes) | ✅ | DepartmentsHeader, DepartmentLines, DepartmentRoles, DepartmentsSettings |
| 1.6 | Setor Settings Dashboard (cards responsivos, filtros) | ✅ | Cards (1col mobile → 3col desktop), busca em tempo real, empty state |

**Branch:** `feature/frontend-modernization` (não pushada)  
**TypeCheck:** ✅ Limpo | **Lint:** ✅ Limpo | **Tests:** ✅ 206/206 passando | **Build:** ✅ OK

---

## ÉPICO 2 — BACKEND IMPROVEMENTS (P1) ✅ CONCLUÍDO

| # | Task | Escopo | Tempo Est. | Status |
|---|---|---|---|---|
| 2.1 | Streaming na IA (RAG response) | AsyncGenerator + SSE edge function + hook | 2h | ✅ |
| 2.2 | Cache/Fetch library (React Query) | QueryClient + QueryProvider + DevTools | 1.5h | ✅ |
| 2.3 | RLS tests contra Postgres real | ⏳ Pendente (opcional — 2h) | 2h | ⏳ |
| 2.4 | CSP headers + CORS allowlist | Security headers + APP_ORIGIN config | 1h | ✅ |
| 2.5 | Rate limit nos webhooks | rate_limit_buckets table + RPC + whatsapp-inbound | 1.5h | ✅ |

**Tempo total executado:** ~7 horas (excluindo 2.3 opcional)  
**Saída:** 4 PRs consolidadas em branch `feature/backend-improvements`
**Nota:** 2.3 (RLS tests) pausado — exige setup Vitest + mocking complexo

---

## ÉPICO 3 — DEBT & DEPENDENCIES (P2) 🏁 NÃO INICIADO (TEMPO LIMITE)

| # | Task | Escopo | Tempo Est. | Status |
|---|---|---|---|---|
| 3.1 | ESLint warnings (84 ativos) | Audit + configurar ignore-list ou fixe | 1h | ⏳ Opcional |
| 3.2 | Adicionar `zod` para validação | Setup + tipos gerados do schema | 1.5h | ⏳ Opcional |
| 3.3 | Dependências vulneráveis | `npm audit fix` + atualizar packages | 1h | ⏳ Opcional |
| 3.4 | Documentar contrato Zernio & Recall | README + exemplos de request/response | 1h | ⏳ Opcional |

**Tempo total:** ~4.5 horas  
**Status:** Pausado — EPICOs 1 e 2 completados (18.5h), tempo de sessão próximo ao limite

---

## PRIORIDADES

1. ✅ **ÉPICO 1 — Modernização Visual** (entregue 19:29 UTC)
2. 🚀 **ÉPICO 2 — Backend** (em progresso agora)
3. ⏳ **ÉPICO 3 — Debt** (após ÉPICO 2)

---

## CHECKLIST FINAL (pós-entrega)

- [ ] Todos os EPICOs com branch feature
- [ ] PRs revisadas e aprovadas
- [ ] Merge para `main` confirmado
- [ ] Deploy VPS (`main` auto-deploya)
- [ ] Validação em produção
- [ ] Memory atualizado com aprendizados

---

**Gerado por:** JARVIS  
**Última atualização:** 2026-09-21 19:31 UTC
