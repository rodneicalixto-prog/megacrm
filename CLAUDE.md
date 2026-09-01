# CLAUDE.md — WhatsApp Hub (Agentise)

## Visão geral

Plataforma open source self-hosted de automação WhatsApp. Uma instância
atende **uma única organização**: criação de templates assistida por IA,
aprovação na Meta via Zernio, disparos em massa por Broadcasts, agente de IA
com RAG, inbox em tempo real com handoff IA ↔ humano, dashboard analítico.

> Para o passo a passo de instalação pelo wizard `/setup`, consultar `README.md`. O `CLAUDE.md` foca
> em *como o código está organizado* e nas regras a respeitar ao alterá-lo.

---

## Stack

- **Frontend.** React 18 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui.
- **Backend.** Supabase Cloud (Postgres, Auth, Realtime, Edge Functions,
  Storage, pgvector).
- **Jobs & Cron.** `pg_cron` + `pg_net` para disparos em batch e follow-ups.
- **API WhatsApp.** Zernio (`https://zernio.com/api/v1`) — intermediário que
  relaya para a Meta Cloud API. Toda comunicação (templates, broadcasts, inbox,
  mídia) passa pelo Zernio; o aluno conecta o WhatsApp no Zernio (Embedded
  Signup) e informa apenas a `ZERNIO_API_KEY`. Webhooks entram assinados com
  `X-Zernio-Signature` (HMAC-SHA256).
- **Embeddings.** OpenAI `text-embedding-3-small` (sempre, independente da
  LLM escolhida).
- **LLMs disponíveis.** OpenAI · Anthropic Claude · Google Gemini. A escolha
  fica na credencial `llm_provider` em `public.app_settings` (definida no
  wizard `/setup` ou em `/settings/credentials`) e é lida em runtime via
  `getCredential`. Não existe env var `LLM_PROVIDER`.
- **Transcrição de áudio.** OpenAI Whisper.
- **Idioma da interface.** Português BR (sem i18n no v1).

---

## Self-Hosted Setup

A instalação de produção é orientada pelo wizard `/setup`. Ele coleta os
tokens de bootstrap, roda migrations, deploya Edge Functions, configura as
envs core na Vercel e persiste credenciais de aplicação criptografadas em
`public.app_settings`.

### Infraestrutura desta instância

Confirmado por acesso direto via MCP em 01/09/2026 — não é genérico, é o
projeto real usado neste repositório:

- **Supabase** — project ref `lstbxeaasyysboavdati` (nome exibido no painel:
  "calixto testesProject", região `us-east-1`, org `jfpiyugtvtuihjuqweyc`).
  Dashboard: `https://supabase.com/dashboard/project/lstbxeaasyysboavdati`.
  Referenciado como produção neste repo desde antes desta entrada (ver seção
  10 do `PLANEJAMENTO.md`); o nome "testes" no painel é do próprio Supabase,
  não indica que seja um ambiente descartável — não foi criado por mim.
- **Vercel** — projeto `megacrm`, org/team `rodnei-calixto-s-projects`
  (`projectId prj_1iE9MHZnppfqexTd6XN7grwOUulb`, `teamId
  team_xCWGuCpqFbPqf4VvIFxJXrJe`). Dashboard:
  `https://vercel.com/rodnei-calixto-s-projects/megacrm`. Cada branch/PR
  ganha preview em `megacrm-git-<branch>-rodnei-calixto-s-projects.vercel.app`
  — **não confirmado** qual branch está publicada no domínio de produção
  (fora do escopo verificado até agora, ver `ISSUES.md`).

---

## Arquitetura multi-schema (Supabase compartilhado)

O mesmo Supabase pode hospedar várias apps Agentise. Cada app vive em seu
próprio schema PostgreSQL.

### Schemas ativos

- `public` — *deveria* ficar reservado a extensions e ao cofre de
  credenciais/bootstrap deste projeto (`app_settings`, `_bootstrap_state`,
  ver seção "Credenciais e bootstrap" abaixo). **Na prática, em 01/09/2026,
  tem 68 tabelas** — a maioria de um sistema alheio (nome de origem "Tomik
  CRM": clientes, agendamentos, financeiro, WhatsApp e automações n8n
  próprios), confirmado pelo dono do projeto como em desuso. 9 dessas
  tabelas estavam sem RLS e com acesso total liberado pra `anon`/
  `authenticated` — travadas nessa data (ver `ISSUES.md`, entrada "Schema
  `public` com outro sistema exposto"). As outras ~59 não foram auditadas
  em detalhe. **NÃO usar `public` para dados de aplicação do
  `whatsapp_hub`** — o risco de colidir com essa bagunça existente é real.
- `agentise_chat`
- `prospector`
- `crm_sofia`
- `whatsapp_hub` — **este projeto**.

### Regras de schema

1. Toda tabela de aplicação fica em `whatsapp_hub.*`.
2. Migrations começam com:
   ```sql
   CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
   SET search_path TO whatsapp_hub;
   ```
3. Cada schema tem seu próprio conjunto de policies RLS.
4. Nunca fazer cross-schema joins sem aprovação explícita.
5. Storage buckets prefixados: `whatsapp-hub-*`.
6. PostgREST precisa expor o schema (ver `README.md` passo 4).

### Padrão de queries no frontend

```ts
const { data } = await supabase
  .schema('whatsapp_hub')
  .from('conversations')
  .select('*');
```

Nunca usar o schema `public` para lógica de aplicação.

---

## Auth & Roles

- Supabase Auth com email/senha.
- Enum `whatsapp_hub.tenant_role` (nome herdado, semântica nova): **4
  valores** — `'super_admin' | 'admin' | 'supervisor' | 'operator'`.
  `super_admin` foi removido na migração para OSS v1.0.0 e reintroduzido na
  fase de hierarquia/departamentos (`20260808160000_roles_add_values.sql`).
- Departamentos (`whatsapp_hub.departments`): cada `app_users` pertence a um
  (`department_id`). O departamento `is_restricted` ("Administração Geral")
  só é visível para `super_admin`.
- Trigger `whatsapp_hub.handle_new_user` em `auth.users`
  (`20260808180000_hierarchy_roles.sql`):
  - Primeiro usuário da instância vira `super_admin` (dono), não `admin`.
  - Convite nativo grava `raw_user_meta_data.invited_role` ∈ `{super_admin,
    admin, supervisor, operator}` e opcionalmente `invited_department`; sem
    departamento no convite, cai no departamento `is_default`.
  - Sem convite válido, `RAISE EXCEPTION` — self-signup fica desabilitado.
  - Insere em `app_users (user_id, role, department_id, accepted_at = now())`.
  - Espelha a role em `auth.users.raw_app_meta_data.role` para que policies
    possam consultá-la via JWT sem ler `app_users`.
- `app_users` é a tabela de membros da instância (substitui `tenant_members`
  do build SaaS antigo). UNIQUE por `user_id`.
- Alcance por papel (gateado por `whatsapp_hub.current_user_role()` +
  helpers `current_user_department()` / `department_is_restricted()` /
  `sees_all_departments()`):
  - `super_admin` — topo da hierarquia; único que vê o departamento
    restrito.
  - `admin` — mesmo alcance operacional do `super_admin`, exceto no
    departamento restrito.
  - `supervisor` — administra o próprio departamento; participa da fila de
    round-robin de handoff (`lead_assignment_queue`).
  - `operator` — opera inbox + contatos + tags do dia a dia; também
    participa da fila de round-robin.
  - `admin`/`super_admin` nunca entram na fila de round-robin — só atendem
    por linha pessoal (ver `department_positions`).

### Evolution — múltiplos números, linha pessoal e cobertura

> A lista de "Tabelas centrais" abaixo é herdada do baseline pré-departamentos
> e não lista `department_positions`/`department_connections`/
> `position_coverage`. Documentando aqui até a lista ser reescrita.

- `whatsapp_hub.department_positions` — cargo dentro de um setor;
  opcionalmente vinculado a um `user_id`. Um setor tem N cargos (N números
  ativos por setor já é suportado por design — cada cargo pode ter sua
  própria linha). Desde `20260822120000_position_coverage_and_multi_line.sql`
  um mesmo usuário pode ocupar **até 2 cargos** (era `UNIQUE(user_id)`,
  virou trigger `_enforce_max_positions_per_user` que bloqueia o 3º).
- `whatsapp_hub.department_connections` — número Evolution. `position_id
  NULL` = número de fila do setor (round-robin via `next_department_assignee`,
  no máx. 1 por setor — `department_connections_queue_key`); `position_id`
  preenchido = linha pessoal (a conversa já nasce atribuída ao titular do
  cargo, no máx. 1 conexão por cargo — `department_connections_position_key`).
- `whatsapp_hub.position_coverage` — cobertura temporária de linha pessoal
  (colega ausente). Enquanto houver uma linha com `ended_at IS NULL` para um
  cargo, `connectionForInstance` (`_shared/whatsapp/department-routing.ts`)
  roteia mensagens **novas** dessa linha para `covering_user_id` em vez do
  titular do cargo — sem alterar o vínculo cargo→titular, que volta a valer
  sozinho quando a cobertura acaba. `ends_at` é opcional (previsão de volta);
  o cron `wh-expire-position-coverage` (15min) encerra sozinho quando vence,
  ou encerra manualmente (UI em Configurações → Setores, por cargo com linha
  pessoal). Conversas que já existiam antes da cobertura começar não são
  reatribuídas automaticamente — a RLS por departamento já deixa qualquer
  colega do mesmo setor vê-las e responder (ver `conversations_select`),
  então um substituto sempre consegue assumir manualmente.

---

## Banco de dados (schema `whatsapp_hub`)

### Tabelas centrais

```
app_settings (singleton, id = 1)
├── business_hours        JSONB   ({ mon: {start,end}, tue: ..., ... })
├── out_of_hours_message  TEXT
└── onboarding_completed  BOOLEAN  (mantido como flag de "settings preenchidos")

app_users
├── user_id  UUID  (FK auth.users, UNIQUE)
├── role     ENUM('super_admin','admin','supervisor','operator')
├── is_active BOOLEAN DEFAULT true  (suspensão reversível por nível hierárquico)
├── invite_accepted_at TIMESTAMPTZ  (NULL = convite pendente; aceite de uso único)
├── invite_claim_id UUID            (lock efêmero contra aceite concorrente/replay)
├── invite_claimed_at TIMESTAMPTZ   (lease de 10min; recupera crash durante aceite)
├── is_online  BOOLEAN
├── last_seen_at, accepted_at, created_at, invited_at

ai_agent_config  (múltiplos perfis desde 20260828120000 — teste A/B/C/D, ver "Agente IA + RAG")
├── name, variant_key (UNIQUE), traffic_pct INT DEFAULT 100, is_control BOOLEAN
├── system_prompt TEXT
├── temperature   FLOAT DEFAULT 0.7
├── max_tokens    INT   DEFAULT 1000
├── is_active     BOOLEAN DEFAULT true

contacts
├── id, phone (E.164, UNIQUE), name, email
├── custom_fields JSONB

tags
├── id, name (UNIQUE), color

contact_tags  (N:N contact_id × tag_id)

templates
├── id, name (UNIQUE), category ENUM('marketing','utility','service','authentication') -- 'service' nunca foi removido do enum (só ganhou 'authentication' depois); não usar para atendimento livre, que não é template
├── language DEFAULT 'pt_BR'
├── status ENUM('draft','pending','approved','rejected')
├── meta_template_id, meta_template_status
├── header_type, header_content
├── body, footer
├── buttons   JSONB
├── variables JSONB  (posição → descrição)
├── ai_prompt TEXT   (prompt original do usuário, quando gerado por IA)

campaigns
├── id, name, template_id
├── status ENUM('draft','scheduled','sending','completed','paused','failed')
├── scheduled_at      TIMESTAMPTZ NULL
├── audience_filter   JSONB (tags + custom_fields filters)
├── variable_mapping  JSONB (variável → contact field / CSV column)
├── total_contacts, sent, delivered, read, replied, failed  INT
├── zernio_broadcast_id   (broadcast mais recente que disparou a campanha)

campaign_contacts  (fila de disparo + métricas por contato)
├── id, campaign_id, contact_id
├── status ENUM('pending','sent','delivered','read','replied','failed')
├── error_message
├── sent_at, delivered_at, read_at, replied_at
├── zernio_message_id, zernio_conversation_id, zernio_broadcast_id
├── template_id_override   (per-row, usado por follow-ups)

follow_up_rules
├── trigger_condition ENUM('no_reply')
├── delay_hours INT
├── template_id   (template do follow-up)
├── sequence_order INT
├── is_active BOOLEAN

mass_dispatches  (módulo "Disparo em massa" — via Evolution, paralelo a campaigns/Zernio)
├── id, name, connection_id (FK department_connections)
├── status ENUM('draft','scheduled','sending','paused','completed','failed')
├── audience_filter JSONB ({mode:'all'|'tags'|'file', tag_ids?, file_id?})
├── min_delay_seconds, max_delay_seconds, next_send_at  (throttle: 1 envio/tick/disparo)
├── total_contacts, sent, replied, failed  INT

mass_dispatch_messages  (até 5 modelos por disparo, sorteados a cada envio)
├── id, dispatch_id, content, media_url, media_type, position

mass_dispatch_contacts  (fila de envio; UPDATE só por service role)
├── id, dispatch_id, contact_id
├── status ENUM('pending','sent','replied','failed')  -- sem 'delivered'/'read': Evolution não manda ACK aqui
├── message_id_used, error_message, evolution_message_id
├── claimed_at, sent_at, replied_at

mass_dispatch_files  (listas de contato + anexos, reaproveitáveis entre disparos)
├── id, name, file_type ENUM('contact_list','attachment')
├── storage_path, media_type, file_size_bytes
├── contact_ids UUID[]  (só contact_list — resolvido no upload, find-or-create por telefone)

conversations
├── id, contact_id (UNIQUE)
├── status ENUM('ai_active','human_active','closed')
├── assigned_to UUID, assigned_at
├── ai_paused BOOLEAN DEFAULT false
├── last_message_at, unread_count
├── zernio_conversation_id   (id da conversa 1:1 no Zernio)

messages
├── id, conversation_id
├── direction ENUM('inbound','outbound')
├── sender_type ENUM('contact','ai','operator','system')
├── sender_id UUID (operador, opcional)
├── content_type ENUM('text','image','audio','video','document','template','note')
├── content TEXT, media_url TEXT
├── zernio_message_id, meta_status ENUM('sent','delivered','read','failed')  -- meta_status = status de entrega relayado pelo Zernio
├── is_private_note BOOLEAN DEFAULT false

webhook_events  (idempotência do zernio-webhook)
├── zernio_event_id TEXT PK, event_type, processed_at

knowledge_base
├── id, name, type ENUM('pdf','doc','url')
├── source_url, file_path, file_size_bytes
├── status ENUM('processing','ready','error')

knowledge_chunks
├── id, knowledge_base_id
├── content TEXT, embedding VECTOR(1536)
├── metadata JSONB

notifications
├── id, user_id, type ENUM('new_message','handoff','mention','sla_breach')
├── conversation_id, message_id
├── title, body, is_read

meetings  (Reuniões — Google Meet numa conta única compartilhada entre setores)
├── id, title, description, department_id (nullable), created_by
├── starts_at, ends_at, attendees JSONB (e-mails)
├── status ENUM('scheduled','recording','processing','completed','failed','canceled')
├── google_event_id, meet_link           (lado Google Calendar)
├── recall_bot_id, recording_url, transcript, summary, error_message  (lado Recall.ai, opcional)
```

### Extensions (schema `public`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;     -- RAG
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- helpers gerais
CREATE EXTENSION IF NOT EXISTS pg_cron;    -- jobs agendados
CREATE EXTENSION IF NOT EXISTS pg_net;     -- HTTP a partir do Postgres
```

### RLS

- Toda tabela de domínio tem RLS habilitado.
- Padrão: `SELECT` aberto a `authenticated`; `INSERT/UPDATE/DELETE` gated por
  `whatsapp_hub.current_user_role()`. Templates / campanhas / knowledge são
  admin-only para escrita; contatos / conversas / mensagens permitem
  operadores + admin.
- `app_settings` e `ai_agent_config` são singletons com escrita admin-only.
- `notifications` filtrada por `user_id = auth.uid()`.

### RPCs notáveis

- `whatsapp_hub.knowledge_search(p_query_embedding vector, p_top_k int)` —
  similarity search (cosine) no corpus, retornando `(id, knowledge_base_id,
  content, similarity)`.
- `whatsapp_hub.current_user_role()` — usado nas policies RLS.

### Credenciais e bootstrap (schema `public`)

Diferente das tabelas de domínio (que vivem em `whatsapp_hub`), o cofre de
credenciais e o estado de bootstrap ficam em `public` por serem infra de
instância, não dados de aplicação. Criadas pela migration
`20260521180500_setup_infra.sql`:

```
public.app_settings              <- SINGLE SOURCE OF TRUTH das credenciais
├── key             text PK       (ex.: zernio_api_key, zernio_account_id, zernio_profile_id, zernio_webhook_secret, zernio_number_info, llm_provider, ...)
├── value_encrypted text          (AES-256-GCM, formato "iv:tag:cipher")
└── updated_at      timestamptz

public._bootstrap_state           <- checkpoints idempotentes do wizard /setup
├── step         text PK          (connection_ok, migrations_done, owner_created, ...)
├── completed_at timestamptz
└── metadata     jsonb            (nunca guarda senha; só user_id/email/count)
```

- **Não confundir** com `whatsapp_hub.app_settings` (o singleton de
  `business_hours` / `out_of_hours_message`). São tabelas distintas, em schemas
  distintos, com propósitos distintos.
- Ambas têm RLS habilitado **sem nenhuma policy** → inacessíveis a `anon` e
  `authenticated`. Só a service role (API Routes Vercel + Edge Functions) lê e
  escreve. O frontend nunca consulta `app_settings` diretamente.
- **Leitura — `getCredential(key)` é o único acessador**, sobre `app_settings`:
  - Node (API Routes): `src/lib/credentials.ts`
    (`encrypt`/`decrypt`/`getCredential`/`setCredential`).
  - Deno (Edge Functions): `_shared/credentials.ts` (decrypt-only + cache 60s).
  - `_shared/tenant-credentials.ts::loadAppCredentials()` é apenas um **wrapper
    tipado** sobre `getCredential` — não é fonte de verdade e não lê env vars.
- **Escrita** só via `api/credentials.ts` (`setCredential`), que valida cada
  valor server-side e exige sessão de owner/admin.
- `CRYPTO_KEY` (env core) decifra os valores; sem ela os dados em
  `app_settings` são irrecuperáveis.

---

## pg_cron jobs

| Job                        | Cadência     | Função                    |
|----------------------------|--------------|----------------------------|
| `wh-dispatch-campaigns`      | 30 segundos  | `dispatch-campaign`       |
| `wh-dispatch-mass-messages`  | 30 segundos  | `dispatch-mass-message`   |
| `wh-check-follow-ups`        | a cada 15min | `check-follow-ups`        |
| `wh-sync-broadcast-status`   | a cada 2min  | `sync-broadcast-status`   |
| `wh-expire-position-coverage`| a cada 15min | SQL puro (sem Edge Function) — encerra cobertura de linha pessoal cujo `ends_at` venceu |
| `wh-check-sla`                | a cada 5min  | `check-sla` — avisa quando um lead espera resposta humana há mais de `app_settings.sla_minutes` (default 15) |

> O antigo `wh-check-template-status` (polling 5min) apontava pra uma Edge
> Function já removida (`check-template-status` → renomeada
> `sync-template-status`, hoje manual). A migration que deveria tê-lo
> desagendado (`20260623120000_zernio_schema.sql`) não pegou nesta instância
> — confirmado em 21/08/2026 ainda ativo em produção, gerando 404 a cada 5min
> — e foi removido de fato por `20260821170000_unschedule_stale_crons.sql`.
> O status do template chega pelo webhook
> `whatsapp.template.status_updated`.
>
> Os dois crons diários de recompra (`repurchase-predictions-daily`,
> `repurchase-dispatch-daily`) também foram desagendados na mesma migration —
> o módulo Vendas & Recompra está sendo removido do projeto (ver
> `PLANEJAMENTO.md`), e os jobs continuavam ativos disparando mensagens de
> recompra reais.

Os jobs invocam Edge Functions via `pg_net.http_post`. URL do projeto e
service role key vêm de Vault entries (`whatsapp_hub_supabase_url`,
`whatsapp_hub_service_role_key`) seedadas pelo `npm run db:push`.

---

## Funcionalidades

### Templates com IA

1. Operador escolhe categoria (Marketing / Utility / Authentication), descreve
   o objetivo, marca variáveis e tipo de header. ("Service" não é categoria de
   template — atendimento livre é resposta dentro da janela de 24h.)
2. Frontend chama `generate-template`. A função lê o provider de
   `app_settings` (`getCredential('llm_provider')`), monta o prompt e devolve
   o template estruturado.
3. Operador revisa, edita se quiser, e submete. `submit-template` envia ao
   Zernio: `POST /whatsapp/templates` com `{accountId, name,
   category(MARKETING|UTILITY|AUTHENTICATION), language, components}`.
4. O status (`approved` / `rejected`) chega pelo webhook
   `whatsapp.template.status_updated` — sem polling.

### Disparos em massa

1. Selecionar template aprovado.
2. Audiência: tags + filtros custom + upload CSV/XLSX (E.164 + dedup).
3. Mapear variáveis → campos do contato / colunas do CSV.
4. Agendar ou disparar imediatamente.
5. `dispatch-campaign` (cron 30s) lê batch de `campaign_contacts.pending`,
   agrupa por template e cria **Broadcasts** no Zernio (criar → adicionar
   destinatários em lotes de 100 → `send`). Batching, retry e rate-limit ficam
   por conta do Zernio — sem loop de tier/backoff próprio. Grava
   `zernio_broadcast_id` por linha para correlação dos status.
6. `zernio-webhook` ingere statuses (sent / delivered / read / failed) e
   incrementa contadores agregados na campanha.

### Follow-up rules

- Cadeia ordenada por `sequence_order` (1, 2, 3 …).
- `check-follow-ups` (cron 15min) acha `campaign_contacts` cujo status ≠
  `replied` e cujo `sent_at + delay_hours < now()`, e enfileira nova
  mensagem com `template_id_override` apontando ao template do follow-up.
- Resposta do contato em qualquer ponto cancela follow-ups futuros.

### Agente IA + RAG

- Knowledge base aceita PDFs, docs e URLs (até 30MB no total).
- `process-knowledge`: extract → chunk (500 tokens, overlap 50) → embed
  (`text-embedding-3-small`, 1536d) → store em `knowledge_chunks`.
- Mensagem inbound aciona `process-ai-message`:
  0. Seleciona o **perfil de IA** (`ai_agent_config`, múltiplas linhas — teste
     A/B/C/D): entre os perfis `is_active=true` habilitados para o canal da
     conversa, escolhe um via hash determinístico (FNV-1a) de `contact_id`
     contra `traffic_pct` acumulado — mesmo contato sempre cai no mesmo
     perfil, evitando trocar de "personalidade" no meio da conversa. Sem
     nenhum perfil habilitado no canal, a conversa vai para atendimento
     humano (mesmo comportamento do antigo gate de canal). `messages.ai_config_id`
     grava qual perfil respondeu, para comparação de métricas por variante
     (`useAiObservabilityByProfile`, painel em `AIAgentSettings.tsx`).
  1. Busca top-5 chunks via `knowledge_search`.
  2. Monta prompt com `system_prompt` (do perfil escolhido) + contexto +
     histórico da conversa.
  3. Chama o provider configurado na credencial `llm_provider`.
  4. Envia resposta via Zernio (mensagem 1:1 na inbox, dentro da janela de 24h).
- Handoff: operador clica "Pausar IA" → `conversation.ai_paused = true` →
  trigger `_on_handoff_notify` faz fanout para todos operadores.
- Áudio do contato → `transcribe-audio` baixa o áudio da URL do attachment
  (entregue pelo webhook do Zernio) → Whisper → salva como `content`, mantendo
  `media_url`.

### Inbox

- Layout 3 painéis (lista de conversas, thread, dados do contato).
- Realtime via Supabase Realtime nos canais de `messages` e `conversations`,
  populados pelos webhooks do Zernio (`message.received` + status).
- Mídia do operador: `send-operator-media` sobe o arquivo via Zernio
  `/media/upload-direct` (máx 25MB) e envia com `attachmentUrl`.
- Notas privadas (`is_private_note = true`) — fundo diferenciado, locais, nunca
  enviadas ao Zernio.
- Atribuição automática round-robin entre operadores com `is_online = true`.
- Filtros: status, assigned_to, tags, período.

### Chat interno

- DM 1:1 entre membros da instância, sem relação com contatos/atendimento —
  rota própria (`/team-chat`), não é uma aba do Inbox.
- `whatsapp_hub.internal_conversations` (par `user_a < user_b`, `UNIQUE`) +
  `whatsapp_hub.internal_messages`. Sem canais por setor e sem regra de
  visibilidade por departamento — qualquer membro fala com qualquer outro.
- Conversa é obtida via RPC `get_or_create_internal_conversation(p_peer_id)`
  (normaliza o par e faz upsert); marcar como lida via
  `mark_internal_conversation_read(p_conversation_id)`. Não há policy de
  INSERT/UPDATE direta em `internal_conversations` — só essas duas RPCs
  `SECURITY DEFINER` escrevem nela, o que impede o client de forjar o par ou
  a marca de leitura do outro participante.
- Presença reaproveita o heartbeat que já existe pro round-robin
  (`app_users.is_online`/`last_seen_at`) — `list_operators()` passou a
  devolver os dois campos, sem mecanismo de presença novo.
- Realtime nos dois canais (`internal_conversations`, `internal_messages`),
  mesmo padrão do Inbox.

### Reuniões (Google Meet)

- Uma única conta Google ("Gmail fixo") compartilhada entre todos os
  departamentos — não há credencial por setor. Qualquer operador agenda pelo
  CRM; a reunião nasce na agenda dessa conta única, com link do Meet gerado
  automaticamente via Calendar API (funciona em Gmail comum, sem Workspace).
- Sem fluxo de "Conectar com Google" na UI: as credenciais
  (`google_oauth_client_id`/`client_secret`/`refresh_token`) são coladas
  manualmente em `/settings/credentials` — o refresh token é gerado uma vez
  via [OAuth Playground](https://developers.google.com/oauthplayground)
  (escopo `https://www.googleapis.com/auth/calendar`).
- Gravação/transcrição/resumo são **opcionais** e dependem de um bot de
  terceiros, [Recall.ai](https://www.recall.ai) (`recall_api_key`) — sem essa
  credencial a reunião ainda é criada normalmente, só sem gravação. O bot
  entra na chamada no horário agendado, grava, transcreve (via legendas da
  própria chamada) e avisa por webhook (`recall-webhook`, autenticado por
  `recall_webhook_secret` na query string `?token=`, mesmo padrão do webhook
  Evolution). O resumo é gerado pelo mesmo adapter multi-LLM do resto do CRM
  (`_shared/llm.ts`, respeitando `llm_provider`/`llm_api_key`).
- `schedule-meeting` cria o evento no Google + agenda o bot (best-effort: se
  a Recall.ai falhar, a reunião segue criada, só sem gravação).
  `cancel-meeting` apaga o evento e cancela o bot (se ainda não tiver
  entrado), marcando `status = 'canceled'` — sem hard delete, o acervo
  mantém o histórico.
- `whatsapp_hub.meetings` não tem policy de INSERT para `authenticated`: só a
  service role (dentro de `schedule-meeting`) grava, porque criar a linha
  exige o `meet_link` do Google primeiro — um INSERT direto pelo client
  criaria uma reunião "fantasma" sem link nenhum.
- Payload do webhook da Recall.ai é tratado como **ASSUMIDO** (não validado
  contra uma conta real) — `recall-webhook` só lê o `bot_id` do corpo do
  evento e busca o status/gravação de verdade via `GET /bot/{id}/`, o que
  isola o handler de variações no formato exato do payload.

### Dashboard

- Cards de métricas (mensagens enviadas / entregues / lidas / respondidas,
  com trend %).
- Métricas secundárias: custo por conversa (pricing Meta por categoria + país —
  o Zernio repassa o preço da Meta, zero markup), tempo médio de resposta da IA,
  tempo médio do humano, distribuição de status das conversas.
- Widget de saúde do número (tier / quality / health) via `zernio-number-status`
  (cache de `number-info`).
- Gráficos Recharts: line (volume / dia), bar (taxas por campanha), donut
  (status).

---

## Estrutura de pastas (frontend)

> A rota `/templates` não existe mais como página própria — redireciona pra
> `/campaigns?tab=templates` (`router.tsx`). `settings/sections/` cresceu de
> 5 para 11 arquivos com a fase de hierarquia/departamentos/Evolution.

```
src/
├── app/
│   ├── routes/
│   │   ├── setup/            Bootstrap Supabase (URL + anon key → localStorage)
│   │   ├── auth/              Login, signup
│   │   ├── invite/            aceite de convite (Supabase Auth nativo)
│   │   ├── dashboard/
│   │   ├── inbox/
│   │   ├── team-chat/         Chat interno — DM 1:1 entre membros, sem relação com atendimento
│   │   ├── campaigns/         inclui a aba Templates (rota própria removida)
│   │   ├── mass-dispatch/     Disparo em massa via Evolution (abas Disparos/Arquivos, módulo `disparo_massa`)
│   │   ├── contacts/
│   │   ├── knowledge/
│   │   ├── follow-ups/
│   │   ├── funil/             pipeline/CRM (deals, estágios, arquivar/restaurar)
│   │   ├── agenda/            calendários (whatsapp_hub.calendars/calendar_events)
│   │   ├── meetings/          Reuniões — Google Meet + gravação/resumo via Recall.ai (opcional)
│   │   ├── ai-agent/          config do agente de IA (system_prompt, mídia, canais)
│   │   ├── vendas/            Vendas & Recompra — saindo do projeto (ver PLANEJAMENTO.md)
│   │   └── settings/
│   │       ├── SettingsPage.tsx
│   │       ├── CredentialsPage.tsx
│   │       └── sections/
│   │           ├── AccountSettings.tsx
│   │           ├── AIAgentSettings.tsx
│   │           ├── AgentMediaSettings.tsx
│   │           ├── BrandingSettings.tsx
│   │           ├── BusinessHoursSettings.tsx
│   │           ├── DepartmentsSettings.tsx
│   │           ├── EvolutionCard.tsx
│   │           ├── InstagramCard.tsx
│   │           ├── LeadAssignmentSettings.tsx
│   │           ├── ProductsSettings.tsx
│   │           └── TeamSettings.tsx
│   ├── layout/               AppLayout, Sidebar, Header, nav-config.ts (canSeeAdminNav)
│   ├── router.tsx            RequireSetup → RequireSession → AppLayout
│   └── providers/
│       ├── SupabaseProvider.tsx
│       ├── AuthProvider.tsx
│       └── AppUserProvider.tsx   (consome app_users, expõe role + heartbeat de presença)
├── components/
│   ├── ui/                   primitives shadcn
│   ├── inbox/                ChatBubble, ConversationList, MessageThread, …
│   ├── campaigns/            CampaignWizard, VariableMapper, AudienceSelector
│   ├── templates/            TemplateEditor, TemplatePreview, AIGenerator
│   ├── contacts/             ContactTable, ImportContactsDialog, TagManager
│   ├── crm/                  componentes do funil/pipeline
│   ├── funil/                board de deals, arquivar/restaurar
│   ├── dashboard/             widgets, AttendancePanel
│   ├── credentials/           campos de credenciais (CredentialField, …)
│   ├── origin/                atribuição UTM/tracking
│   └── NotificationsDropdown.tsx
├── hooks/                    useCampaigns, useConversations, useTemplates,
│                             useContacts, useKnowledgeBase, useDashboardMetrics,
│                             useFollowUpRules, useMessages, useNotifications,
│                             useTags, useSupabase, useOperators, useDepartments
├── lib/                      supabase.ts (dynamic client), phone.ts (E.164), chunk.ts (chunkArray)
├── types/                    db, inbox, campaigns, templates, knowledge
└── styles/globals.css        Tailwind v4 + dark glassmorphism tokens
```

## Edge Functions

> Lista das funções em `supabase/functions/` (32 diretórios funcionais nesta
> revisão; versões anteriores
> deste documento listavam só 14 — conferir aqui antes de assumir que uma
> função não existe). `_shared/` cresceu bastante desde a migração
> Zernio → Zernio+Evolution; ver `_shared/whatsapp/` para a camada agnóstica
> de provedor.

```
supabase/functions/
├── _shared/
│   ├── auth.ts               requireCaller/requireAdmin/requireSupervisor/requireServiceRole
│   ├── roles.ts               CallerRole, ADMIN_ROLES, canOperate()
│   ├── cors.ts               jsonResponse, preflight
│   ├── llm.ts                multi-provider adapter (OpenAI/Claude/Gemini, texto + visão)
│   ├── supabase-admin.ts     service role client
│   ├── credentials.ts        getCredential()/setCredential() sobre public.app_settings (SSOT)
│   ├── tenant-credentials.ts loadAppCredentials() → wrapper tipado de getCredential
│   ├── zernio.ts             client Zernio (inbox, broadcasts, templates, mídia, number-info)
│   ├── ai-reply.ts           pós-processamento da resposta do LLM ([HANDOFF], [MEDIA:...])
│   ├── auto-move-lead.ts     IA move o lead pelo funil quando o critério do estágio bate
│   ├── business-hours.ts     variáveis de horário de atendimento pro prompt da IA
│   └── whatsapp/             camada agnóstica de provedor (Zernio × Evolution)
│       ├── types.ts          NormalizedInbound, WhatsAppProvider, helpers de parsing
│       ├── zernio-provider.ts
│       ├── evolution-provider.ts
│       ├── department-routing.ts  número que recebeu → departamento/conexão dona
│       └── outbound.ts       envio pela rota Evolution (a rota Zernio não passa por aqui)
├── zernio-webhook/           ingestão (X-Zernio-Signature) de statuses + inbound; idempotência via webhook_events
├── whatsapp-inbound/         webhook Evolution (HMAC) — fecha atribuição de lead + roteia por departamento
├── dispatch-campaign/        consumido por pg_cron 30s — cria Broadcasts no Zernio
├── dispatch-mass-message/    consumido por pg_cron 30s — disparo em massa via Evolution (texto livre, timing randômico; módulo `disparo_massa`, paralelo a campaigns)
├── check-follow-ups/         consumido por pg_cron 15min
├── sync-broadcast-status/    consumido por pg_cron 2min — reconcilia entrega de broadcasts
├── sync-template-status/     sincroniza status de templates direto da Meta (fallback manual ao webhook)
├── process-ai-message/       RAG → LLM → resposta via Zernio ou Evolution (inbox 1:1)
├── process-knowledge/        upload → chunk → embed → store (+ fallback de OCR por visão)
├── transcribe-audio/         baixa áudio → Whisper → grava content → aciona process-ai-message
├── generate-template/        prompt → LLM → JSON estruturado de template
├── submit-template/          POST p/ Zernio `/whatsapp/templates`
├── send-operator-message/    operador envia texto / nota privada pela inbox
├── send-operator-media/      operador envia mídia (upload-direct → attachmentUrl)
├── send-operator-template/   operador reabre conversa fora da janela de 24h com template aprovado
├── interact-message/         presence (composing/paused) e reação — só rota Evolution
├── resolve-inbound-media/    repara URL de mídia Evolution que falhou no player
├── zernio-number-status/     status cacheado do número (tier/quality/health) p/ dashboard
├── schedule-meeting/          cria reunião no Google Calendar (Meet automático) + agenda bot de gravação (Recall.ai, opcional)
├── cancel-meeting/            apaga evento no Google + cancela bot; marca a reunião como canceled (sem hard delete)
├── recall-webhook/            (público) ingere status do bot Recall.ai; ao concluir, transcreve e resume via _shared/llm.ts
├── ingest-lead/               (público) captação de lead via snippet de landing page
├── redirect-tracker/         (público) redirecionador de link com rastreio de clique
├── repurchase-dispatch/      dispara mensagens de recompra — cron desagendado em 21/08/2026, módulo saindo
├── simulate-inbound/         dev only — finge mensagem inbound
├── test-zernio-connection/   valida a conexão Zernio (GET /whatsapp/number-info)
├── invite-team-member/       convite nativo do Supabase Auth (inviteUserByEmail + invited_role)
├── accept-team-invite/       consome convite uma vez, define senha e revoga a sessão do link
├── set-team-member-active/   super_admin/admin suspende ou reativa níveis inferiores (Auth ban + app_users)
└── delete-team-member/       admin remove membro (Auth + app_users)
```

---

## Convenções de código

### Geral
- TypeScript strict mode.
- ESLint + Prettier.
- Componentes: PascalCase. Hooks: `useThing.ts`. Edge Functions: kebab-case.
- Comentários: português para regra de negócio; inglês para código técnico.

### Supabase / frontend
- Client criado via `getSupabase()` a partir das envs core injetadas no build
  apos o wizard `/setup`.
- **Sempre** usar `.schema('whatsapp_hub')` no client.
- Tipos manuais em `src/types/`. Não usamos `supabase gen types` no v1.
- Canal Realtime (`.channel(...)`) **nunca** usa nome estático — dois
  componentes montando o mesmo hook (ou o duplo-mount do StrictMode) colidem
  no mesmo nome de canal e o Supabase JS derruba a subscription (crash em
  runtime). Sempre sufixar com um id por montagem, ex.
  `` `meetings-changes:${Math.random().toString(36).slice(2, 10)}` `` — ver
  `useConversations.ts`, `useMessages.ts`, `useNotifications.ts`,
  `useKnowledgeBase.ts`, `usePipeline.ts`, `useMeetings.ts` e
  `useInternalChat.ts` (os três últimos corrigidos em 01/09/2026 — o nome do
  canal levar a chave do recurso, tipo `internal-messages-${conversationId}`,
  não basta: precisa do sufixo aleatório também, senão dois mounts com a
  mesma conversa/usuário colidem do mesmo jeito).
- Todo hook que lê/escreve no Supabase deve checar `error` do retorno —
  nunca desestruturar só `data` e descartar o resto. Padrão do projeto:
  `console.error('[useX] falha ao ...', error)` + expor um estado `error`
  pro componente decidir se mostra algo. `useInternalChat.ts` e
  `useOperators.ts` engoliam erro silenciosamente (throw nunca acontecia,
  UI ficava com lista vazia sem indicar falha) até 01/09/2026.

### Edge Functions
- Toda função pública passa pelos helpers `_shared/auth.ts`. Nunca pular essa
  validação.
- Credenciais de aplicação têm como **fonte de verdade** `public.app_settings`
  e são lidas via `getCredential` (`_shared/credentials.ts`).
  `_shared/tenant-credentials.ts::loadAppCredentials()` é só um wrapper tipado
  sobre ele — nunca lê env vars de aplicação. `Deno.env.get(...)` fica restrito
  a envs core (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRYPTO_KEY`).
- Resposta padrão: `{ data, error, message }` via `jsonResponse`.
- Logging estruturado: `console.log(JSON.stringify({ event, ... }))`.

### Segurança
- HMAC-SHA256 (timing-safe) na validação do webhook Meta.
- Tokens / API keys nunca trafegam pelo frontend — todas as chamadas a
  Meta / OpenAI / Claude / Gemini saem das Edge Functions.

---

## Design System — Dark Mode Glassmorphism (OBRIGATÓRIO)

> **Desatualizado neste ponto e corrigido em 21/08/2026**: esta seção dizia
> "dark mode only, sem toggle", mas `src/components/ThemeToggle.tsx` existe e
> o `CHANGELOG.md` documenta "Light/dark theme selection" como já entregue —
> a plataforma hoje tem os dois temas via `document.documentElement.dataset.theme`
> (`localStorage` key `megacrm-theme`). Os tokens abaixo continuam sendo o
> tema dark padrão; um tema light equivalente foi adicionado sem substituir
> este documento — vale conferir `styles/globals.css` para os tokens do modo
> claro antes de assumir que só o dark existe.

### Tokens de cor

| Token                  | Valor                                        |
|------------------------|----------------------------------------------|
| `--bg-primary`         | `#0A0A0F`                                    |
| `--bg-card`            | `rgba(15, 18, 35, 0.6)`                      |
| `--border-card`        | `rgba(59, 130, 246, 0.15)`                   |
| `--accent-primary`     | `#3B82F6`                                    |
| `--accent-secondary`   | `#60A5FA`                                    |
| `--gradient-primary`   | `linear-gradient(135deg, #1E3A8A, #3B82F6)`  |
| `--text-primary`       | `#F8FAFC`                                    |
| `--text-secondary`     | `#94A3B8`                                    |
| `--text-label`         | `#CBD5E1`                                    |
| `--color-success`      | `#10B981`                                    |
| `--color-error`        | `#EF4444`                                    |

### Background glow (no `body`)

```css
body {
  background-color: #0A0A0F;
  background-image:
    radial-gradient(ellipse at 20% 0%, rgba(59, 130, 246, 0.06), transparent 50%),
    radial-gradient(ellipse at 80% 100%, rgba(37, 99, 235, 0.04), transparent 50%);
  min-height: 100vh;
}
```

### Glass card padrão

```css
.glass-card {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(59, 130, 246, 0.02));
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 16px;
  box-shadow:
    0 0 20px rgba(59, 130, 246, 0.06),
    inset 0 1px 0 rgba(59, 130, 246, 0.1);
}

.glass-card:hover {
  border-color: rgba(59, 130, 246, 0.45);
  box-shadow:
    0 0 30px rgba(59, 130, 246, 0.12),
    0 0 60px rgba(59, 130, 246, 0.04),
    inset 0 1px 0 rgba(59, 130, 246, 0.2);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Tipografia

```css
* { font-family: 'Inter', sans-serif; }

.text-display { font-weight: 700; }
.text-stat    { font-size: 2.5rem; font-weight: 800; }

.text-label {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.text-body { font-weight: 400; font-size: 0.875rem; }
```

### Bordas e separadores

- Borders padrão: `rgba(59, 130, 246, 0.12)`.
- Dividers: `rgba(59, 130, 246, 0.08)`.
- Sidebar `border-right`: `1px solid rgba(59, 130, 246, 0.1)`.
- Header `border-bottom`: `1px solid rgba(59, 130, 246, 0.08)`.

Componentes devem usar `var(--accent-primary)` / `var(--accent-secondary)` em
vez de hardcodear `#3B82F6` / `#60A5FA`. Os hex listados acima são apenas o
fallback default.

---

## Notas de migração e variáveis não-triviais

- A proposta de agentes internos por setor e memória organizacional está em
  `docs/INTERNAL-AI-AGENTS.md`. Ela é deliberadamente separada do pipeline
  `process-ai-message` de atendimento externo; não implementar como apenas mais
  um perfil em `ai_agent_config` sem ACL/RLS e governança próprias.
- Decisões consolidadas para futura segunda memória e treinamento vivem em
  `docs/memory/`. Esses arquivos são contexto canônico revisável, não dumps de
  conversa; `docs/memory/README.md` define status e regras de ingestão.

- `tenant_members` foi renomeada para `app_users` na Fase 4 da migração SaaS
  → OSS. O enum `whatsapp_hub.tenant_role` manteve o nome por inércia; hoje
  aceita 4 valores (`super_admin`/`admin`/`supervisor`/`operator`, ver seção
  "Auth & Roles") — `super_admin` foi removido nessa mesma migração e
  reintroduzido depois, na fase de hierarquia/departamentos.
- A fonte de verdade das credenciais de aplicação é `public.app_settings`
  (KV criptografado), acessada por `getCredential`/`setCredential`.
  `_shared/tenant-credentials.ts` mantém o nome histórico, mas hoje é só um
  wrapper tipado sobre `getCredential` — não lê env vars nem é fonte própria.
- `campaign_contacts.template_id_override` é per-row e existe para que o
  dispatcher use um template diferente do template-pai da campanha em
  follow-ups.
- `raw_user_meta_data.invited_role` no convite é o canal pelo qual
  `handle_new_user` aceita um valor pré-definido de role. Sem ele, a regra
  default (1º usuário = admin, demais = operator) decide.
- A Vault entry `whatsapp_hub_encryption_key` ainda existe por motivos
  históricos (a migração `20260422120012` a cria), mas nenhum código atual
  consome `encrypt_secret`/`decrypt_secret`.
- **Migração Meta Cloud API → Zernio.** Toda a comunicação WhatsApp passou a
  sair pelo client `_shared/zernio.ts` (Deno) e `src/lib/zernio.ts` (Node, só no
  setup). Mudanças não óbvias:
  - `messages.meta_message_id`/`campaign_contacts.meta_message_id` renomeados
    para `zernio_message_id`. `meta_status` foi **mantido** (é o status de
    entrega genérico, agora relayado pelo Zernio) para não tocar tipos do
    frontend.
  - Colunas novas: `conversations.zernio_conversation_id`,
    `campaign_contacts.zernio_conversation_id/zernio_broadcast_id`,
    `campaigns.zernio_broadcast_id`. Tabela `webhook_events` (idempotência).
  - Disparo em massa usa **Broadcasts** do Zernio (não o loop por-contato na
    Meta); o motor de follow-up próprio (pg_cron) foi mantido — não migrou para
    Sequences do Zernio.
  - Convites são 100% Supabase Auth nativo (`invite-team-member` →
    `inviteUserByEmail`); o Resend, a tabela `invites` e o link com token foram
    removidos.
  - O `meta_tier` (enum + credencial) saiu; o tier vem de `number-info`,
    cacheado na credencial `zernio_number_info`.
  - Vários shapes de payload do Zernio (webhook inbound/status, `upload-direct`,
    corpo do send message, endpoint de registro de webhook) estão marcados
    `ASSUMIDO` no código — confirmar contra a API real no 1º teste de integração.
