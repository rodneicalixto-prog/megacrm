# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- Mensagens de áudio recebidas: `transcribe-audio` grava a transcrição
  em `messages.content`, mas esse `UPDATE` não redispara o trigger
  `AFTER INSERT` que aciona `process-ai-message` — a IA ainda não vê a
  transcrição no primeiro turno de um áudio. Gap pré-existente, já
  citado em `20260422120022_audio_trigger.sql`; exige mudança de
  trigger, fora do escopo desta rodada.
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
