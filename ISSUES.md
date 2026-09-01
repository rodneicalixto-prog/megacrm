# Issues conhecidas

> Rastreamento local. Com o repositório já em um remoto GitHub, cada entrada
> aqui deve virar uma issue real — este arquivo é o backlog enquanto isso não
> acontece.

## Setup pendente — secrets do workflow `drift-check.yml`

- **Status:** aberta — depende de ação manual do usuário no GitHub.
- **O que é:** `.github/workflows/drift-check.yml` (adicionado 01/09/2026)
  roda `scripts/check-drift.mjs` diariamente pra detectar os dois problemas
  achados nesta sessão antes que virem incidente de novo: migration aplicada
  em produção sem arquivo commitado, e tabela de `whatsapp_hub` sem RLS.
- **Falta:** cadastrar dois repo secrets em Settings → Secrets and variables
  → Actions — `SUPABASE_ACCESS_TOKEN` (PAT do Supabase) e `PROJECT_REF`
  (`lstbxeaasyysboavdati`). Sem eles o workflow falha logo de cara (mensagem
  clara, não silenciosa) em toda execução agendada.
- **Próximo passo:** usuário cadastrar os secrets; depois disso, rodar o
  workflow manualmente uma vez (`workflow_dispatch`) pra confirmar que passa.

## `xlsx@0.18.5` — Prototype Pollution + ReDoS, sem fix no npm

- **Status:** aberta.
- **Severidade:** 🔴 high (duas CVEs).
  - [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) —
    Prototype Pollution (corrigida em 0.19.3).
  - [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) —
    ReDoS (corrigida em 0.20.2).
- **Onde:** `src/components/contacts/ImportContactsDialog.tsx` e
  `src/hooks/useSalesUpload.ts`. Ambos usam só `XLSX.read` + `sheet_to_json`.
- **Causa:** a SheetJS deixou de publicar no registry npm. A versão que está
  lá (`0.18.5`) é anterior às duas correções e **nunca será atualizada**.

### Exposição real

O parse acontece **no browser**, em arquivo que o próprio usuário escolheu —
não há ingestão server-side de planilha de terceiro. Isso reduz o impacto em
relação ao rótulo "high": o pior caso é um admin ser induzido a importar uma
planilha hostil, e a poluição de protótipo escalar para XSS na sessão dele.
Sério, mas não é comprometimento de servidor.

### Como corrigir

Caminho oficial do fornecedor — mesma API, sem mudança de código:

```bash
npm rm xlsx
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Rodar em máquina/CI com acesso a `cdn.sheetjs.com`, e commitar o
`package-lock.json` resultante.

- **Por que não foi aplicado:** o sandbox onde a correção foi tentada bloqueia
  `cdn.sheetjs.com` por política de rede. Alterar o `package.json` sem
  conseguir instalar deixaria o `package-lock.json` dessincronizado e quebraria
  o `npm ci` da CI — pior do que a issue em aberto.
- **Sobre `@e965/xlsx`:** existe no npm, na 0.20.3, e corrige as duas CVEs.
  **Não é publicado pela SheetJS**, é republicação de terceiro. Para um pacote
  que faz parse de arquivo enviado pelo usuário, isso troca uma CVE conhecida
  por um mantenedor desconhecido. Usar só como último recurso.

## ✅ Migration drift — RLS de `contacts`/`products` corrigida direto em produção — resolvido

- **Status:** fechada em 01/09/2026 — migration retroativa commitada
  (`20260901195523_operator_scope_contacts_and_products.sql`).
- **Verificado nesta sessão** via `list_migrations` + `execute_sql` (read-only)
  contra o projeto de produção (`lstbxeaasyysboavdati`, MCP Supabase). A
  migration remota `operator_scope_contacts_and_products` (aplicada
  01/09/2026) mudou duas policies, confirmadas lendo `pg_policies` direto:
  - `contacts_select` — era `USING (true)` (`20260430120002_drop_multitenant.sql`,
    todo autenticado lia todos os contatos); virou a mesma lógica de
    `sees_all_departments() OU dono/participante do departamento da
    conversa` já usada em `conversations_select`.
  - `products_write` — era `current_user_role() IN ('admin','operator')`
    (`20260711160000_custom_pipelines_and_lead_fields.sql`); virou
    `sees_all_departments()` (restringe de operator pra admin/super_admin).
  - `contacts_write` e `products_select` **não mudaram** — texto idêntico ao
    já commitado.
- **`handle_new_user()` — sem drift real, apesar do relato inicial.**
  Comparei o `pg_get_functiondef` de produção com
  `20260808180000_hierarchy_roles.sql` linha a linha (só variam comentários
  e a forma como o Postgres normaliza `SET search_path` na exibição) — o
  corpo da function já é idêntico ao que está commitado. A causa mais
  provável: alguém alterou a function direto em produção num ponto
  anterior, quebrando-a pros 4 usuários afetados, e a "correção" de hoje foi
  restaurá-la pro texto que este repo já tinha — não uma mudança nova. Não
  precisa de migration.
- **Remediação dos 4 usuários** — fix de dado pontual (`UPDATE app_users`
  pra quem tinha role errada), não schema. Não é recriável numa migration
  de forma que faça sentido (uma instância nova nunca teve o bug), então
  fica só documentada aqui, não replicada em SQL.

## `react-router-dom@6.30.4` — 3 advisories moderate

- **Status:** aberta, sem ação planejada. Reavaliar quando houver cobertura de
  teste nas rotas.
- **Severidade:** 🟡 moderate — mas **não alcançável nesta base** (análise
  abaixo). O fix exige subir para 7.x, um major com breaking changes.
- **Advisories:**
  - [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2) e
    [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) —
    open redirect via `<Link>` / `useNavigate`.
  - [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) —
    injeção de construtor em `deserializeErrors()` na hidratação SSR.

### Por que não é alcançável

- **Open redirect:** exige que entrada controlada pelo usuário chegue ao
  destino de um `<Link to>` ou `navigate()`. Nesta base, todo destino é um path
  literal com um UUID vindo do banco interpolado
  (`/inbox?conversation=${id}`, `/contacts/${id}`, `/funil?deal=${id}`). Query
  params são lidos, mas só para selecionar dado — nunca voltam como destino.
- **Hidratação SSR:** o projeto é SPA Vite pura. Não há SSR.

Subir para React Router 7 sem nenhum teste de rota, para fechar advisories que
não têm caminho de exploração aqui, troca risco teórico por risco real de
regressão. A dívida fica registrada.

## ✅ Branch órfã com 5 features já refletidas em produção — mergeada

- **Status:** fechada em 01/09/2026 — PR aberta e mergeada a partir de
  `claude/platform-update-planning-0gojqn`.
- **O que era:** ao investigar a entrada acima, `list_migrations` mostrou 6
  migrations em produção sem arquivo em `main`: `quick_replies_search_mentions`,
  `contact_duplicate_flag`, `sla_alert`, `ai_observability`,
  `campaign_ab_variants`, `ai_agent_profiles`. Uma busca em todas as branches
  remotas (`git ls-tree` em cada uma) achou as 6 na branch
  `claude/platform-update-planning-0gojqn` — 5 commits ("Onda 1" a "Onda 4":
  respostas rápidas/@menções no inbox, SLA + dedup de contato, observabilidade
  de IA, teste A/B de campanhas, múltiplos perfis de IA), nunca mergeados em
  `main`, mas já aplicados em produção (schema) antes de hoje.
- **Risco que isso representava:** o schema de produção já tinha 6 features
  que o frontend de `main` não sabia usar — se o deploy publicado seguisse
  `main` em vez dessa branch, haveria colunas/tabelas novas sem UI nenhuma
  as usando. Não foi confirmado qual branch estava de fato publicada no
  Vercel antes do merge.

## ✅ Tenants fantasmas no banco — já continham exposição, já travados

- **Status:** verificado e fechado em 01/09/2026. Já havia sido corrigido
  antes (migration `20260821150000_rls_legacy_tenant_tables.sql`, no repo)
  — esta rodada só confirmou que a correção está de fato ativa em produção.
- **Origem confirmada:** `whatsapp_hub.tenants` (4 linhas),
  `tenant_members` (4), `tenant_settings` (4), `tenant_credentials` (0) —
  sobras da migração SaaS → self-hosted. `20260430120002_drop_multitenant.sql`
  fez `DROP`/`RENAME` dessas tabelas no *código* do repositório, mas o banco
  de produção (`lstbxeaasyysboavdati`) tinha divergido dessa migration e
  ainda tinha as quatro tabelas de pé, **com RLS desligado** — expostas a
  `anon`/`authenticated` via a anon key, não só "lixo inofensivo".
- **Verificado nesta sessão** via `pg_class.relrowsecurity` +
  `information_schema.role_table_grants`: as 4 tabelas têm
  `relrowsecurity=true` e `open_grants=0` em produção — a migration citada
  acima já está aplicada e efetiva. Nenhuma ação nova precisou ser tomada.
- Não apagamos as 4 linhas remanescentes — ficam como histórico morto,
  inacessíveis por RLS, sem risco.

## ✅ Schema `public` com outro sistema (Tomik CRM) exposto sem RLS — travado

- **Status:** mitigado em 01/09/2026 (achado + travado na mesma sessão, com
  confirmação do dono do projeto antes de qualquer mudança).
- **Severidade era 🔴 high, confirmada, não hipotética.** `information_schema.tables`
  em produção mostrou **68 tabelas em `public`**, não só
  `app_settings`/`_bootstrap_state` como este `CLAUDE.md` descrevia — a
  maioria pertence a um sistema alheio ao `whatsapp_hub` (aparência de CRM +
  agendamento de clínica + financeiro + integração WhatsApp própria +
  automações n8n: `clients`, `patients`, `appointments`, `consultations`,
  `crm_leads`, `despesas`/`entradas`/`pagamentos`, `n8n_workflows`,
  `whatsapp_instances`/`whatsapp_messages`, `tomikcrm_schema_migrations`,
  etc. — nome de origem "Tomik CRM", confirmado pelo dono do projeto como
  **em desuso**).
- **O achado real:** 9 dessas tabelas (`analytics_events`, `app_migrations`,
  `crm_stage_aliases`, `entradas_source_links`, `produtos_relacionados`,
  `report_filter_presets`, `tomikcrm_schema_migrations`,
  `user_dashboard_prefs`, `user_preferences`) estavam **sem RLS e com GRANT
  total** (`SELECT/INSERT/UPDATE/DELETE`) para `anon` **e** `authenticated`
  — ou seja, qualquer usuário logado de **qualquer app** hospedada nesse
  mesmo Supabase, incluindo o `whatsapp_hub` deste repositório, conseguia
  ler e escrever nelas via PostgREST sem nenhuma restrição. As outras ~59
  tabelas do Tomik já tinham RLS com policies próprias — não auditadas em
  detalhe, mas não estavam no mesmo nível de exposição.
- **Ação tomada (confirmada, não hipotética):** `ALTER TABLE ... ENABLE ROW
  LEVEL SECURITY` (mesmo padrão de `public.app_settings` — zero policy, só
  service role acessa) + `REVOKE ALL ... FROM anon, authenticated` nas 9
  tabelas. Verificado depois via `pg_class.relrowsecurity` e
  `information_schema.role_table_grants`: as 9 mostram `rls_enabled=true` e
  `open_grants=0`. Aplicado direto via MCP do Supabase (`apply_migration`),
  **não** commitado como migration deste repositório — não é schema do
  `whatsapp_hub`, então não pertence a `supabase/migrations/`.
- **O que ficou por auditar:** as outras ~59 tabelas do Tomik (RLS
  presente, mas as policies em si não foram lidas) e se o mesmo problema
  existe nos outros schemas citados no `CLAUDE.md` (`agentise_chat`,
  `prospector`, `crm_sofia`) — não verificados nesta sessão.
