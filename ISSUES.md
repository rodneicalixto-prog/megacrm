# Issues conhecidas

> Rastreamento local. Com o repositório já em um remoto GitHub, cada entrada
> aqui deve virar uma issue real — este arquivo é o backlog enquanto isso não
> acontece.

## ✅ Secrets do workflow `drift-check.yml` — cadastrados

- **Status:** fechada em 03/09/2026 — `SUPABASE_ACCESS_TOKEN` e `PROJECT_REF`
  cadastrados pelo usuário em Settings → Secrets and variables → Actions.
  Workflow rodado manualmente (`workflow_dispatch`, run
  [33797513465](https://github.com/rodneicalixto-prog/megacrm/actions/runs/33797513465))
  e confirmado lendo produção de verdade — ver as duas entradas abaixo pro
  que essa primeira execução revelou.

## ✅ `check-drift.mjs` comparava só por `version` — 25 falsos positivos

- **Status:** fechada em 03/09/2026 — PR
  [#47](https://github.com/rodneicalixto-prog/megacrm/pull/47).
- **O que era:** a primeira execução real do `drift-check.yml` (após
  cadastrar os secrets) reportou 28 "migrations aplicadas em produção sem
  arquivo local". Investigação (comparando cada `name` devolvido pelo
  Supabase contra `supabase/migrations/`, rodado num sandbox contra o clone
  real do repo): **25 das 28 tinham arquivo local de verdade**
  (`mass_dispatch`, `internal_chat`, `meetings`, etc.) — o Supabase registra
  em `schema_migrations.version` o timestamp de QUANDO a migration foi
  aplicada via `push-migrations.mjs` (Management API), que diverge do
  timestamp no nome do arquivo commitado; o campo `name` devolvido junto,
  porém, sempre bate com o arquivo real.
- **Fix:** `scripts/check-drift.mjs` agora aceita match por `version` OU por
  `name` (stem completo ou slug). Validado localmente contra os 28 registros
  reais dessa execução antes do PR: resultado é exatamente as 3 exceções já
  documentadas abaixo, zero drift real não-documentado.

## ✅ 3 migrations sem arquivo — já eram exceções documentadas, não drift

- **Status:** confirmado em 03/09/2026, nenhuma ação nova necessária.
- `fix_handle_new_user_hierarchy_aware` e
  `remediate_users_affected_by_old_trigger` — fix pontual de dado em
  `app_users` pra 4 usuários afetados + restauração de function pro texto
  que o repo já tinha (ver entrada mais abaixo sobre `handle_new_user()`).
  Não recriável como migration de forma que faça sentido — instância nova
  nunca teve o bug.
- `lock_down_unprotected_public_tables` — `ENABLE ROW LEVEL SECURITY` +
  `REVOKE` nas 9 tabelas do schema "Tomik CRM" (`public.*`, sistema alheio
  ao `whatsapp_hub`, ver entrada mais abaixo). Não é schema deste
  repositório, não pertence a `supabase/migrations/`.
- Essas 3 agora estão em `KNOWN_EXCEPTIONS` no script — aparecem como `INFO`
  no log do workflow, não derrubam o job.

## ✅ `tests/unit/inbox-date-filters.test.ts` — 2 testes com data hardcoded ("bomba-relógio")

- **Status:** fechada em 03/09/2026 — PR
  [#47](https://github.com/rodneicalixto-prog/megacrm/pull/47).
- **O que era:** achada ao investigar uma falha de CI não-relacionada nesse
  mesmo PR. Dois testes usavam `Date.now()` (hora real de quando o teste
  roda) comparado contra uma data **hardcoded** no próprio teste (`closedOn:
  '2026-09-02'`, `createdOn: '2026-09-01'`) — só passavam no dia exato em
  que foram escritos, falhando sozinhos a partir do dia seguinte (03/09 foi
  o primeiro dia a quebrar). O teste vizinho no mesmo arquivo (`fila
  Encerrados mostra somente hoje...`) já fazia certo: `now = new
  Date('2026-09-02T15:00:00Z').getTime()` fixo em vez de `Date.now()`.
- **Fix:** os dois testes (`finalizados hoje usa a data de São Paulo...` e
  `dia do gráfico inclui conversas criadas no dia...`) agora usam o mesmo
  `now` fixo do teste vizinho.

## ✅ `xlsx@0.18.5` — Prototype Pollution + ReDoS — corrigido

- **Status:** fechada em 03/09/2026 — PR [#48](https://github.com/rodneicalixto-prog/megacrm/pull/48).
- **O que era:** duas CVEs sem fix no npm (SheetJS parou de publicar lá) —
  [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
  (Prototype Pollution) e
  [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)
  (ReDoS).
- **Fix:** trocado pro build oficial da SheetJS via CDN
  (`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), mesma API,
  sem mudança de código em `ImportContactsDialog.tsx`/`useSalesUpload.ts`.
- **Causa real do CI ter ficado quebrado por várias tentativas antes do
  merge:** não era o xlsx — era o `package-lock.json`, gerado no Windows,
  com metadados de plataforma incompletos para uma dependência opcional do
  `esbuild@0.28.2` (puxada pelo `vitest@4`, não relacionada ao xlsx).
  Corrigido gerando o lockfile num Linux real (WSL local, mesma versão de
  Node/npm do runner do CI) antes do push final.

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

## CORS wildcard + rate limit parcial nos webhooks públicos — reconfirmado em 03/09/2026

- **Status:** aberta. Reconfirmado direto contra `main` (não é achado de memória
  antiga) — `supabase/functions/_shared/cors.ts` ainda tem
  `Access-Control-Allow-Origin: '*'` em toda função.
- **Severidade:** 🟡 moderate. Auth é via bearer token (não cookie), então o
  wildcard de CORS não abre CSRF nas rotas autenticadas — mas amplia
  desnecessariamente a superfície.
- **5 funções realmente públicas** (`verify_jwt = false` em `supabase/config.toml`):
  `ingest-lead`, `redirect-tracker`, `whatsapp-inbound`, `zernio-webhook`,
  `recall-webhook`.
- **Rate limit real (`whatsapp_hub.bump_rate_limit`, migration
  `20260808130000_rate_limit.sql`) só está ligado em `ingest-lead`.** As
  outras 4:
  - `whatsapp-inbound` e `zernio-webhook` — protegidas por HMAC-SHA256
    constant-time (`X-Zernio-Signature` vs `zernio_webhook_secret`), mas sem
    limite de taxa mesmo em tráfego com assinatura válida.
  - `recall-webhook` — segredo compartilhado via query string (`?token=`),
    mais fraco que HMAC, sem rate limit.
  - `redirect-tracker` — **sem autenticação nenhuma por design** (é um link
    clicável público) e sem rate limit. É o de maior exposição real dos 5:
    dá pra inundar de hits sem precisar forjar nada.
- **`dispatch-campaign`** tem throttling próprio de tier Meta (mecanismo
  diferente, não usa `bump_rate_limit`) — não confundir com os 5 acima.

### Sugestão (não aplicada — decisão de produto/risco do dono)

- CORS: trocar `'*'` por allowlist de origem (`APP_ORIGIN` do `.env`), já que
  as 5 funções públicas não dependem de origem arbitrária pra funcionar
  (native app/browser sempre chama do mesmo domínio; webhooks de terceiro nem
  olham CORS, é o navegador que aplica).
- `redirect-tracker`: aplicar o mesmo `bump_rate_limit` já usado em
  `ingest-lead` (bucket por IP ou por slug de redirect).
- `whatsapp-inbound`/`zernio-webhook`/`recall-webhook`: rate limit adicional
  como defesa em profundidade, mesmo já tendo HMAC/secret — um segredo
  vazado ou reaproveitado não deveria virar flood ilimitado.
