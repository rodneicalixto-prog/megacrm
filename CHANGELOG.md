# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Ordered round-robin assignment queues per department for supervisors and
  operators.
- Direct routing for personal WhatsApp lines linked to an occupied department
  position, bypassing department queues.
- Inbox controls for quoted replies, reactions, forwarding, typing presence,
  screenshots, emoji selection, and Evolution voice notes.
- Light/dark theme selection, navigable dashboard cards, and on-demand contact
  details in the Inbox.
- Notification grouping by contact and pending-action type.

### Fixed

- Hide the `super_admin` row in `app_users` from everyone except `super_admin`
  itself (Fase C item 12), and let `super_admin` actually see the team list:
  `app_users_self_select` compared literally against `'admin'`, so even the
  instance owner could only see their own row.
- Scope `conversations`/`messages` reads and writes by department (Fase C of
  the hierarchy plan, never implemented): both `SELECT` policies had been
  `USING (true)` since the multi-tenant removal, so any authenticated user
  could read every conversation and message, including the restricted
  "Administração Geral" department that's supposed to be `super_admin`-only.
  The department helpers (`current_user_department`, `department_is_restricted`,
  `sees_all_departments`, `is_super_admin`) already existed but were never
  referenced by any policy. Also fixed `conversations_write`/`messages_write`,
  which still filtered `current_user_role() IN ('admin','operator')` — a
  residue from before the hierarchy phase that silently blocked `supervisor`
  and `super_admin` from writing to conversations/messages at all (pause AI,
  mark as read, assign), since the frontend writes to these tables directly
  and isn't routed through a service-role Edge Function.
- Let the instance owner (`super_admin`) actually use Team Settings: `isOwner`
  compared literally against `'admin'`, so the person the UI itself calls
  "o owner desta instância" couldn't see the invite form or the remove
  button — the backend (`invite-team-member`/`delete-team-member`) already
  accepted `super_admin` via `requireAdmin`, only the frontend gate was wrong.
- Restore unlimited personal pipeline creation for supervisors and operators:
  the RLS policy (`pipelines_insert`) and the `FunilManager` UI already fully
  supported any operating role creating their own pipeline with no cap
  ("owner_id = auth.uid()", no quantity limit), but the "Gerenciar funis"
  button that opens that UI was gated `adminOnly`, so only admin/super_admin
  could ever reach it — supervisors and operators had no way to create a
  personal pipeline at all, despite the backend already allowing it.
- AI agent now replies on a contact's first audio turn: `transcribe-audio`
  invokes `process-ai-message` directly after writing the transcript (the
  `UPDATE` on `messages.content` doesn't re-fire the `AFTER INSERT` trigger
  that normally drives the reply), and `process-ai-message` treats a
  transcribed audio message like text.
- Lead round-robin auto-assignment (`next_department_assignee`) now prefers
  supervisors/operators with recent presence (`is_online = true` and
  `last_seen_at` within 2 minutes) but falls back to plain round-robin when
  nobody qualifies — a same-day regression had this always assigning nobody,
  because nothing in the app ever wrote `is_online = true`. Added a
  `set_own_presence` RPC and a 45s heartbeat in `AppUserProvider` so presence
  is now actually tracked, and closed a privilege-escalation gap in the
  process: the RLS policy that let a user update their own `app_users` row
  for presence purposes had no column-level check, so any authenticated user
  could already set their own `role` directly from the client. A guard
  trigger now restricts self-updates to `is_online`/`last_seen_at`.
- Chunk the two unbounded `.in()` reads left in `useContacts.ts` (tags/deals
  for the current page, and bulk delete) into batches of 100 — they were
  missed when the rest of the file was fixed for the same issue, and became
  reachable once the 1000-row page size option shipped.
- Chunk the CSV/XLSX contact-import `.in()` reads (tag assignment, lead
  dedup) from 500 to 100, matching the limit used everywhere else in the
  project; the 500-row upsert body is unaffected.
- Guard against a stale-response race in the Inbox: switching conversations
  fast enough could let an old conversation's message fetch resolve after
  the new one's and overwrite it with the wrong messages.
- Unschedule three stale `pg_cron` jobs found live in production:
  `wh-check-template-status` (targeted an Edge Function removed months ago,
  producing a 404 every 5 minutes) and the two daily repurchase jobs
  (`repurchase-predictions-daily`, `repurchase-dispatch-daily`), which kept
  running — and could still send real repurchase messages — after the
  Vendas & Recompra module was already decided as being removed from the
  product.
- Re-enabled Row Level Security (zero policies, service-role-only — same
  pattern as `public.app_settings`) on the legacy `whatsapp_hub.tenants`,
  `tenant_settings`, `tenant_credentials`, and `tenant_members` tables, which
  had drifted in production with RLS disabled and were exposed to the anon
  key.
- Allow `super_admin`, `admin`, `supervisor`, and `operator` to reply from the
  Inbox.
- Surface Evolution API delivery errors in the Inbox instead of silently
  treating them as successful sends.
- Repair residual multi-tenant inbound and handoff triggers that rejected new
  messages after the `tenant_id` column was removed.
- Release webhook deduplication reservations on persistence failures so
  Evolution can retry instead of silently losing messages.
- Keep the configured global Evolution instance routed to the default
  department during migration while rejecting unknown instance names.
- Prevent personal lines from being linked to positions without an assigned
  user and keep administrators out of automatic assignment queues.
- Recover inbound Evolution audio when the webhook does not include a directly
  playable URL.
- Clear unread state and pending notifications when a conversation is closed;
  closed conversations can no longer appear in the unread queue.
- Remove viewed notifications immediately instead of retaining and stacking
  historical message rows in the notification tray.
- Keep the active Inbox panel synchronized when conversations are closed or
  reopened.

### Docs

- Corrected `CLAUDE.md` drift found by the 21/08/2026 code review: role enum
  (4 values, not 2), Edge Functions list (23 functions, not 14), `pg_cron`
  jobs table, frontend route/folder structure, `templates.category` (4
  values — `'service'` was never actually dropped), and the design-system
  claim that light mode doesn't exist (it does, via `ThemeToggle.tsx`).
  `AGENTS.md` stopped duplicating this content — it now points to
  `CLAUDE.md` as the single source of truth, since the duplication is what
  let it go stale (it still described plain Meta Cloud API, 2 roles, and
  Edge Functions renamed/removed months ago).

### Security

- Keep Evolution group payloads (`@g.us`) disabled until the data model stores
  the group remote JID and outbound replies can be guaranteed to target the
  group instead of a participant's private number.

## [1.1.0] — 2026-08-20

Rodada de melhorias avaliadas a partir do pacote de atualização
"Agosto/2026" da Agentise. Só os itens sem conflito com a arquitetura
atual (departamentos + Evolution API v2 + multi-LLM) foram trazidos —
multi-tenancy por organização, canal UAZAPI e a remoção do seletor de
LLM foram deliberadamente deixados de fora; ver `PLANEJAMENTO.md` seção
9 para a análise completa.

### Added

- **Contatos** — exportação em CSV (todos os filtrados, ou só os
  selecionados) e seletor de linhas por página (25/50/100/1000),
  substituindo o `PAGE_SIZE` fixo de 25 (`src/lib/contactsCsv.ts`,
  `ContactsPage.tsx`).
- **Inbox** — separadores de data (Hoje/Ontem/data) agrupando mensagens
  por dia na thread (`MessageThread.tsx`).
- **Layout** — sidebar recolhível (ícones apenas, estado persistido em
  `localStorage`) e avatares de iniciais para membros da equipe em
  Equipe/Setores (`Sidebar.tsx`, `src/components/ui/Avatar.tsx`).
- **Configurações** — banner de credenciais faltantes (WhatsApp/LLM),
  visível só para admin/super_admin, reaproveitando o endpoint já
  existente de status de credenciais (`useMissingCredentials.ts`,
  `CredentialsBanner.tsx`).
- **Funil** — arquivar/restaurar negócio, paginação "carregar mais" por
  etapa, ordenação (recente/valor/alfabética) e botão "+Negócio" no
  topo do board (`deals.archived_at`, migration
  `20260811140000_deal_archive_and_temperature.sql`).
- **Funil** — trigger que atualiza a temperatura do negócio para Morno
  ao ganhar e Frio ao perder, independente do caminho de UI que mudou o
  status.
- **Agente de IA** — entendimento de imagem nas conversas (OpenAI,
  Claude e Gemini, via bloco de imagem nativo de cada provider);
  fallback de OCR via visão da OpenAI quando a extração de texto de PDF
  na Base de Conhecimento volta vazia; `knowledge_base.error_message`
  com motivo real do erro (chave inválida, sem saldo, PDF ilegível)
  exibido na UI em vez do badge genérico "Erro" (migration
  `20260812120000_knowledge_error_message.sql`).

### Fixed

- Consultas `.in()` que escalavam com o tamanho da base (todos os
  contatos de uma tag, todas as conversas, todos os negócios de um
  pipeline) agora são fatiadas em lotes de 100 e mescladas — evita
  degradação/erro em instalações com volume maior de dados
  (`useCampaigns.ts`, `useContacts.ts`, `useConversations.ts`,
  `usePipeline.ts`, novo `src/lib/chunk.ts`).

### Known gaps (documentados no código, não corrigidos nesta rodada)

- ~~Mensagens de áudio recebidas: `transcribe-audio` grava a transcrição em
  `messages.content`, mas esse `UPDATE` não redispara o trigger
  `AFTER INSERT` que aciona `process-ai-message`~~ — **corrigido em
  2026-08-21** (ver `[Unreleased]`): `transcribe-audio` agora invoca
  `process-ai-message` diretamente no sucesso da transcrição.
- O caminho de renderizar página de PDF em imagem para o fallback de
  OCR (`unpdf`) não foi testado dentro do runtime Deno das Edge
  Functions — precisa de teste de integração real com um PDF
  escaneado antes de confiar nele em produção.
- ~~Migrations desta rodada (`20260811140000`, `20260812120000`)~~ —
  **aplicadas em produção (`lstbxeaasyysboavdati`) em 2026-08-21**, via
  MCP do Supabase, depois de confirmar ausência de conflito (colunas,
  função, trigger, índice). `process-ai-message` e `process-knowledge`
  também foram redeployados com o código desta rodada. Ver
  `PLANEJAMENTO.md` seção 9 para o project ref correto — o documentado
  antes (`yshvniyhtnyhnjcecbft`) estava errado.

## [1.0.0] — 2026-04-30

First open-source self-hosted release. Migration from the SaaS multi-tenant
codebase to a single-organization deployable image.

### Changed

- Migrated SaaS multi-tenant build to Open Source Self-Hosted (single
  organization per instance).
- BYOK removed — Meta and LLM credentials now come from Edge Function
  environment variables (`META_*`, `OPENAI_API_KEY`, `LLM_PROVIDER`,
  `LLM_API_KEY`) instead of the encrypted `tenant_credentials` table.
- White-label (dynamic logo / favicon / brand colors) removed. The fixed
  Agentise dark glassmorphism theme is the only theme.
- Onboarding wizard collapsed into `SettingsPage` sections (AI agent, business
  hours, team, account, Supabase).
- Roles consolidated to `admin` / `operator`. The first signed-up user is
  promoted to `admin`; subsequent users land as `operator`.

### Removed

- `tenants`, `tenant_settings`, `tenant_credentials` tables.
- `tenant_id` from every domain table and from every frontend query / type.
- `super_admin` role and the `/admin` super-admin panel.
- `OnboardingPage` and the six onboarding steps.
- `save-tenant-credentials` Edge Function.
- `whatsapp-hub-logos` storage bucket and its multi-tenant policies.
- `app.whatsapp_hub_encryption_key` Vault entry (and `pgcrypto` symmetric
  helpers used only by `tenant_credentials`).

### Renamed

- `tenant_members` → `app_users`.

### Kept intentionally

- `/setup` route — the operator pastes Supabase URL + anon key into the
  browser on first visit; nothing about the build needs to change per
  deployment.
- Supabase schema namespace `whatsapp_hub` — the Supabase project may be
  shared with other Agentise apps.
- Meta tier caps (`tier_250` / `tier_1k` / `tier_10k` / `tier_100k`) — these
  are official Meta limits, not commercial plans, and gate the dispatcher
  batch size.
- `push-migrations.mjs` and `deploy-functions.mjs` scripts. They use the
  Supabase Management API (no DB password required) and remain the
  recommended ops path.
