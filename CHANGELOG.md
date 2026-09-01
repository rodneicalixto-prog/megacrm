# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Ativação e desativação hierárquica de usuários**: em Configurações →
  Equipe, `super_admin` pode suspender/reativar admins, supervisores e
  operadores; `admin` pode fazer o mesmo com supervisores e operadores. A
  suspensão preserva dados e histórico, aplica ban reversível no Supabase
  Auth e bloqueia imediatamente REST/RPC e Edge Functions, inclusive para um
  token emitido antes da suspensão.
- **Convites de equipe de uso único**: o aceite agora usa claim atômico no
  banco e uma Edge Function dedicada para definir a senha. Tentativas
  concorrentes ou reutilização retornam conflito; ao concluir, a sessão criada
  pelo link é revogada e o usuário precisa entrar com a nova senha.

- **Reuniões (Google Meet + gravação/transcrição/resumo automáticos)**: novo
  módulo `/meetings`. Uma única conta Google compartilhada entre todos os
  departamentos ("Gmail fixo") agenda reuniões com link do Meet gerado
  automaticamente (Calendar API, funciona em Gmail comum sem Workspace) —
  qualquer operador agenda, ninguém precisa da própria credencial Google.
  Gravação/transcrição são opcionais via um bot de terceiros (Recall.ai);
  quando configurado, o resumo é gerado automaticamente pelo mesmo adapter
  multi-LLM já usado no resto do CRM. Acervo compartilhado e pesquisável
  (título, resumo, transcrição) — sem recorte por departamento, por design.
  Credenciais (`google_oauth_client_id/client_secret/refresh_token`,
  `recall_api_key`, `recall_webhook_secret`) ficam prontas para preencher em
  `/settings/credentials`; sem elas configuradas, o agendamento retorna erro
  claro em vez de criar uma reunião pela metade.
  Nova tabela `whatsapp_hub.meetings` + 3 Edge Functions novas
  (`schedule-meeting`, `cancel-meeting`, `recall-webhook`).

### Fixed

- **Certos tipos de mensagem do WhatsApp chegavam como bolha em branco no
  Inbox** (relatado como "não visualizo o que chegou"): confirmado no banco
  que as duas mensagens do caso tinham `content_type: 'text'` e `content:
  null` — o Evolution/Baileys manda alguns tipos de mensagem embrulhados
  num envelope (`ephemeralMessage`, `viewOnceMessage`/`V2`/`V2Extension`,
  `documentWithCaptionMessage` — foto "visualização única", mensagem
  efêmera, documento com legenda) em vez das chaves de sempre
  (`imageMessage`, `conversation`, etc.), e `decodeBaileysContent` não
  desembrulhava, caindo no fallback genérico com `content: null`.
  `decodeBaileysContent` agora desembrulha esses envelopes recursivamente,
  trata `stickerMessage` como imagem, `locationMessage`/`liveLocationMessage`
  e `contactMessage` como texto legível, e — para qualquer tipo ainda não
  mapeado (enquete, resposta de botão/lista, etc.) — devolve um rótulo
  genérico `[Mensagem não suportada: <chave>]` em vez de `content: null`,
  para nunca mais produzir uma bolha vazia sem nenhuma pista do que era.
  As duas mensagens já gravadas em branco foram corrigidas via SQL direto.
  `whatsapp-inbound` redeployado (v13).
- **Botão "Responder" não fazia nada em conversas encerradas**: o composer
  (`MessageInput`, onde apareceria a faixa "Respondendo: ...") só é montado
  quando a conversa não está `closed`. Clicar no ícone de responder numa
  mensagem de uma conversa finalizada atualizava o estado, mas não havia
  onde mostrar isso — parecia um clique morto. `onReply` agora reabre a
  conversa (mesma ação do botão "Reabrir") antes de marcar a mensagem
  como resposta.
- **Link compartilhado (Facebook/Instagram/YouTube...) chegava só como texto
  cru, sem a foto de preview**: o WhatsApp mostra uma miniatura ao lado de um
  link compartilhado, mas o webhook Evolution tratava `extendedTextMessage`
  (o formato Baileys usa pra texto com preview) sempre como `contentType:
  'text'`, ignorando o `jpegThumbnail` (base64) embutido no próprio payload.
  `decodeBaileysContent` agora detecta esse thumbnail e devolve
  `contentType: 'image'` com o texto do link como legenda;
  `EvolutionProvider.downloadInboundMedia` decodifica o `jpegThumbnail` direto
  do payload (sem chamar a API da Evolution) quando presente. Reaproveita a
  pipeline existente de upload pro Storage e o branch de imagem já existente
  em `MessageThread.tsx` — nenhum código novo em nenhum dos dois.
  `whatsapp-inbound` redeployado (v12).
- **Reações do WhatsApp não chegavam ao CRM**: reagir a uma mensagem pelo
  celular (dono da linha) ou pelo contato nunca aparecia na Inbox — o webhook
  Evolution (`whatsapp-inbound`) não reconhecia o payload `reactionMessage`
  do Baileys e tratava o evento como uma mensagem de texto vazia, criando uma
  bolha em branco na conversa em vez de anotar a reação. Novo
  `EvolutionProvider.parseReaction()` intercepta esse payload ANTES do fluxo
  normal de mensagem, localiza a mensagem alvo por `zernio_message_id` e
  atualiza `messages.reactions` (substituindo a entrada anterior da mesma
  origem — contato ou "o dono, pelo celular" — em vez de acumular; texto
  vazio = Baileys removeu a reação). Não mexe em conversas/contadores de não
  lida: reação não é mensagem nova. Também descoberto no processo: mesmo a
  reação dada DENTRO do CRM (`interact-message`, já existente) nunca era
  renderizada em lugar nenhum — `messages.reactions` era escrito mas nunca
  lido pela UI. `MessageThread.tsx` agora mostra um badge de emoji (com
  contagem) sob a bolha quando há reação, cobrindo as duas origens (CRM e
  webhook). `whatsapp-inbound` redeployado (v11).
- **"Card preto" no tema claro**: mais uma leva do mesmo bug já corrigido
  antes nesta sessão (fundo escuro hardcoded, ignorando `data-theme`), desta
  vez em componentes que a varredura anterior (que só buscou `#0A0A0F`) não
  pegou porque usavam um tom ligeiramente diferente (`#0F1223`) ou nem
  seguiam o padrão de token nenhum:
  - `sonner.tsx` (toasts): `theme="dark"` fixo + `rgba(15,18,35,0.85)` fixo no
    fundo — todo toast, em qualquer tela (inclusive a de login, antes de
    haver setor/sessão), sempre saía escuro por cima de um layout claro.
    Agora observa `document.documentElement[data-theme]` via
    `MutationObserver` e usa `var(--surface)`/`var(--color-border-card)`.
  - `NotificationsDropdown.tsx`, `InboxFilters.tsx`, `ContactTagsEditor.tsx`,
    `AIAgentSettings.tsx` (dropdowns flutuantes) e o card de deal do Kanban em
    `FunilPage.tsx`: `bg-[#0F1223]` fixo → `var(--color-bg-elevated)`.
  - Divisores internos do `NotificationsDropdown` (`border-white/5`,
    `bg-white/[0.02]`, `hover:bg-white/[0.04]`, `divide-white/5`) trocados
    pelo mesmo tom azulado translúcido já usado no resto do design system
    (`rgba(59,130,246,0.0X)`) — os valores em branco ficavam praticamente
    invisíveis sobre o fundo branco do tema claro.

- **Security**: 5 `whatsapp_hub` SECURITY DEFINER functions had never had
  `EXECUTE` revoked from `anon`, so any unauthenticated request (the
  public `anon` key baked into the frontend build) could call them
  directly via PostgREST. `list_operators()` leaked every team member's
  e-mail, role, and department to anyone; `bump_campaign_counter`,
  `claim_campaign_contacts`, and `increment_unread_count` (service-role
  internals with no frontend caller at all) let anon corrupt campaign
  metrics, steal a campaign's dispatch queue, or spam a conversation's
  unread count. `import_won_deals_to_sales()` had an admin/operator role
  check, but PL/pgSQL treats `IF NULL THEN` as false, so an anon caller
  (whose `current_user_role()` is NULL) skipped the check entirely and
  could run the import. Found via `mcp__Supabase__get_advisors`, not
  previously documented anywhere. Revoked `anon` (and `authenticated`
  where nothing legitimate calls it) from all 5, and fixed the NULL-logic
  gap explicitly rather than relying on the REVOKE alone.
- The invite form (`TeamSettings.tsx`) only offered Admin/Operador, with no
  Supervisor option and no way to pick the invitee's department — likely
  the actual cause behind a report of "invited user gets super_admin-level
  access": with no Supervisor choice, inviting someone as Admin grants them
  effectively the same operational reach as `super_admin` (see CLAUDE.md's
  Auth & Roles). Added Supervisor (and Owner/`super_admin`, gated to
  `super_admin` callers) plus a department selector — the backend
  (`invite-team-member`) already accepted both, only the form never sent
  them.
- `whatsapp_hub.create_user` (the "cadastrar usuário" flow in
  Departamentos, distinct from the e-mail invite above) creates the account
  without a password on purpose, but nothing told the person a password
  reset was needed — they'd have to guess to use "Esqueci minha senha" on
  the login screen. Now fires `resetPasswordForEmail` automatically right
  after creation, same call `LoginPage.tsx` already used for that flow.
- The top-right corner showed the logged-in user's e-mail; now shows their
  registered name (`operatorLabel`, same "name, falls back to e-mail"
  helper already used everywhere else operators are listed).
- Clearer error message when connecting an Evolution WhatsApp line fails
  with create=403 "already in use" + connect=401: this is the API key not
  having authority over an instance that already exists on the Evolution
  server (not something MegaCRM's code can fix) — the message now says so
  explicitly instead of just relaying the two raw HTTP errors.
- Floating cards/popups (pipeline dialogs, dropdowns, drawers, dialogs) had
  the dark-mode background hardcoded as the literal `#0A0A0F`, so they stayed
  dark even on the light theme. Replaced with the theme-aware
  `var(--color-bg-elevated)` token across 16 files (15 `bg-[#0A0A0F]`
  occurrences plus one `ring-offset-[#0A0A0F]` in `FunilManager.tsx` that the
  first pass missed).

### Added

- **Chat interno** (new route `/team-chat`): 1:1 DMs between instance members,
  fully decoupled from customer conversations — no department scoping, no
  Zernio/Evolution involvement, everyone can message everyone. Didn't exist
  at all before (the only trace was an unused `'mention'` value in
  `notification_type`, dead since the very first migration); requested
  directly by the user after confirming it. New tables
  `internal_conversations` (normalized `user_a < user_b` pair, `UNIQUE`) and
  `internal_messages`, both realtime-enabled. Two `SECURITY DEFINER` RPCs are
  the only write path into `internal_conversations`
  (`get_or_create_internal_conversation`, `mark_internal_conversation_read`)
  — no direct INSERT/UPDATE policy, so a client can't forge the pair or mark
  the other participant's side as read. Presence reuses the existing
  round-robin heartbeat (`app_users.is_online`/`last_seen_at`) instead of a
  new mechanism — `list_operators()` now also returns those two columns.
  Left-panel contact list shows every teammate with an online/offline dot
  and unread indicator; right panel is a plain 1:1 thread.
- Commercial plan gating for Campanhas, Vendas & Recompra, and Agente de IA:
  these three nav items and their pages/RLS writes are now controlled by
  `public.instance_plan.enabled_modules` (service-role-only, no edit UI —
  set manually via SQL/MCP when a client's package changes; defaults to all
  three modules enabled so existing installs aren't affected). New Edge
  Function `get-instance-plan` lets any authenticated user read which
  modules are active; `useEnabledModules()` drives nav filtering (Sidebar,
  MobileNav) and page-level redirects (CampaignsPage, VendasPage,
  AIAgentPage). Write policies on `templates`, `campaigns`,
  `ai_agent_config`, `sales_records`, `repurchase_predictions`,
  `repurchase_config` (plus the `compute_repurchase_predictions`/
  `sales_dashboard` RPCs) now also require the module to be enabled — and,
  as a side effect of touching them, fixed the same "compares literally
  against `'admin'`" bug this session kept finding, so `super_admin` can
  now actually write to those tables. When the Agente de IA module is off,
  `process-ai-message` treats it the same as `ai_agent_config.is_active =
  false` — the agent stops auto-replying, not just the config screen.
- Ordered round-robin assignment queues per department for supervisors and
  operators.
- Direct routing for personal WhatsApp lines linked to an occupied department
  position, bypassing department queues.
- Inbox controls for quoted replies, reactions, forwarding, typing presence,
  screenshots, emoji selection, and Evolution voice notes.
- Light/dark theme selection, navigable dashboard cards, and on-demand contact
  details in the Inbox.
- Notification grouping by contact and pending-action type.
- **Horário de atendimento por departamento e por usuário**: `departments`
  and `app_users` each gained nullable `business_hours`/`out_of_hours_message`
  columns that override the global singleton (`app_settings`) when set —
  NULL means "inherit the level above" (user → department → global), so no
  existing row needed backfilling. A shared `BusinessHoursEditor` component
  (extracted from the existing global-settings screen) now renders in three
  places: unchanged on the global Settings tab, an "override" toggle inside
  each department's panel in DepartmentsSettings.tsx, and a self-service
  "Meu horário de atendimento" card in AccountSettings.tsx. `process-ai-message`
  resolves the cascade (assigned user → conversation's department → global)
  before building the `{dentro_do_horario}`/`{mensagem_fora_horario}` prompt
  variables. Drive-by fix: `app_users_admin_write` compared literally against
  `'admin'`, the same "super_admin excluded" bug pattern fixed repeatedly
  this session — `super_admin` couldn't edit another user's row (including
  their business hours) through that policy.
- **Até 2 linhas pessoais por usuário + cobertura de ausência**: a person can
  now hold up to 2 `department_positions` (was `UNIQUE(user_id)`, hard-capped
  at 1; now a trigger enforces "up to 2" instead of unlimited). New table
  `whatsapp_hub.position_coverage` lets a supervisor/admin mark a personal
  line as covered by a named colleague — while a coverage row is active,
  `connectionForInstance` routes *new* inbound conversations on that line to
  the covering user instead of the absent titular, without touching the
  position→titular link (it resumes automatically once coverage ends). An
  optional `ends_at` lets the new `wh-expire-position-coverage` cron
  (15min, pure SQL, no Edge Function) end it automatically; otherwise it's
  manual. Existing conversations already assigned to the absent person are
  untouched — department-scoped RLS (`conversations_select`) already lets any
  teammate in the same department see and reply to them, so a substitute can
  always pick one up by hand. UI lives in Configurações → Setores, next to
  each position that already has a personal connection. No design for this
  existed anywhere in the repo before — requested directly by the user
  running Evolution in production with departments that have several fixed
  lines and no absence coverage plan.
- **Disparo em massa** (new module, gated by `public.instance_plan` like
  Campanhas/Vendas/Agente de IA): free-text bulk WhatsApp sends over the
  Evolution (WhatsApp Web) connection, distinct from the Zernio/Meta
  `campaigns` module which requires an approved template. Up to 5 message
  variants per dispatch, picked at random per send; a randomized delay
  between sends (`min_delay_seconds`/`max_delay_seconds`, floored at the
  30s cron cadence); audience by tags, an imported contact-list file, or all
  contacts; a reusable "Arquivos" tab for contact lists (CSV/XLSX, parsed
  into contacts on upload) and message attachments. New tables
  (`mass_dispatches`, `mass_dispatch_messages`, `mass_dispatch_contacts`,
  `mass_dispatch_files`), a `wh-dispatch-mass-messages` cron (30s) driving
  a new `dispatch-mass-message` Edge Function, and a reply-detection trigger
  on inbound messages (no delivery/read ACK available on this route today,
  so the quality dashboard only shows what's real: sent/failed/replied).
  This sits outside official WhatsApp Business terms — same ban risk as any
  WhatsApp Web automation tool; the randomized timing only reduces it.
- Pipeline "kind" is now user-chosen at creation time instead of hardcoded to
  `comercial`: `FunilManager.tsx`'s "Novo funil" form gained a
  Financeiro/Atendimento toggle next to the existing Só meu/Da empresa scope
  toggle. `comercial` still seeds the sales-shaped stages (Novo lead / Em
  andamento / Ganho / Perdido) that feed Vendas & Recompra on `is_won`;
  `atendimento` seeds a 3-stage support flow (Aberto / Em atendimento /
  Resolvido) with no "perdido" concept. Existing `pipelines.kind` enum
  already had an unused `'atendimento'` value added in a prior migration;
  proactively guarded `_deal_won_to_sales`, `_deal_unwon_cleanup`, and
  `import_won_deals_to_sales()` with a `pipelines.kind = 'comercial'` check
  first, so marking an atendimento card's stage as `is_won` (e.g. "Resolvido")
  can never insert a phantom sale into `sales_records`/`repurchase_predictions`.

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
- Narrow `operator` visibility on `conversations`/`messages` to only what's
  assigned to them (`assigned_to = auth.uid()`), per explicit product
  decision (21/08/2026) and matching what `docs/PLANO-HIERARQUIA.md` always
  designed for the role — the Fase C fix above had given `operator` the same
  department-wide scope as `supervisor` because that split hadn't been
  decided yet at the time. `supervisor`/`admin`/`super_admin` scope is
  unchanged. Also gated the "Atribuído a" reassignment dropdown in the Inbox
  contact panel for `operator`s: under the new policy a conversation is only
  ever visible to them once it's already assigned to them, so picking anyone
  else there would silently fail the RLS `WITH CHECK` — the control is now
  disabled for `operator`, with a note that reassignment is a
  supervisor/admin action.
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
