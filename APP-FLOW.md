# MegaCRM — Fluxo do App

> Gerado a partir de `src/app/router.tsx`, `src/app/layout/`,
> `src/app/routes/` e `CLAUDE.md` em 28/09/2026. Cobre as telas que existem
> no código; estados de erro/vazio específicos de cada tela que não têm
> componente dedicado ficam marcados `[A PREENCHER]` em vez de assumidos.

---

## Pontos de entrada

- **Wizard `/setup`** — primeira instalação: coleta URL + anon key do
  Supabase (persistido em `localStorage`), roda migrations, deploya Edge
  Functions, configura envs core na Vercel. Só roda uma vez por instância
  (`RequireSetup` no `router.tsx` bloqueia o resto do app até completar).
- **`/auth`** — login (email/senha, Supabase Auth). Sem self-signup: só
  entra quem foi convidado.
- **`/invite`** — aceite de convite nativo. Convite grava
  `invited_role`/`invited_department` em `raw_user_meta_data`; ao aceitar,
  `handle_new_user` cria a linha em `app_users`. Se o convite trouxer linha
  pessoal (cargo com Evolution), a sessão do link fica viva só até a pessoa
  escanear o QR da Evolution (`/api/evolution-instance`), depois é revogada.

## Guarda de rotas (`router.tsx`)

```
RequireSetup → RequireSession → AppLayout (sidebar + header) → rota
```

- `RequireSetup`: sem Supabase configurado, força `/setup`.
- `RequireSession`: sem sessão válida, força `/auth`.
- `AppLayout`: aplica `nav-config.ts` (`canSeeAdminNav`) — itens de admin
  somem do menu para `supervisor`/`operator`.

## Inventário de telas

| Rota | Pra que serve | Dados que precisa |
|---|---|---|
| `/dashboard` | Métricas: mensagens enviadas/entregues/lidas/respondidas, custo por conversa, tempo médio de resposta (IA/humano), saúde do número, gráficos | Agregados de `messages`/`campaign_contacts`/`conversations`, `zernio-number-status` |
| `/inbox` | Atendimento — 3 painéis (fila, thread, dados do contato) | `conversations`, `messages` (realtime), `contacts` |
| `/team-chat` | DM 1:1 interno entre membros, sem relação com atendimento | `internal_conversations`, `internal_messages` (realtime) |
| `/campaigns` (inclui aba Templates) | Criar/editar templates com IA, montar e disparar campanhas via Zernio | `templates`, `campaigns`, `campaign_contacts` |
| `/mass-dispatch` | Disparo em massa via Evolution (paralelo ao módulo de campanhas Zernio) — abas Disparos/Arquivos | `mass_dispatches`, `mass_dispatch_contacts`, `mass_dispatch_files` |
| `/contacts` | Cadastro de contatos, tags, importação | `contacts`, `tags`, `contact_tags` |
| `/knowledge` | Base de conhecimento da IA (PDF/doc/URL) | `knowledge_base`, `knowledge_chunks` |
| `/follow-ups` | Regras de follow-up em cadeia | `follow_up_rules` |
| `/funil` | Pipeline de vendas (deals), arquivar/restaurar | [A PREENCHER — schema de `deals` não está detalhado em `CLAUDE.md` "Tabelas centrais"; conferir migrations] |
| `/agenda` | Calendários | `whatsapp_hub.calendars`/`calendar_events` |
| `/meetings` | Reuniões (Google Meet), gravação/resumo opcional via Recall.ai | `meetings` |
| `/ai-agent` | Config do agente de IA (prompt, mídia, canais, perfis A/B/C/D) | `ai_agent_config` |
| `/vendas` | Vendas & Recompra — **saindo do projeto** (ver `PRD.md` § Fora da versão 1) | [A PREENCHER] |
| `/settings` | Hub de configurações — 11 seções (conta, IA, mídia do agente, branding, horário comercial, departamentos, Evolution, Instagram, atribuição de leads, produtos, equipe) | Cada seção lê sua própria fatia de `app_settings`/tabelas relacionadas |
| `/settings/credentials` | Credenciais de aplicação (Zernio, LLM, Google, Recall.ai, Evolution) — criptografadas em `app_settings`, nunca em `.env` | `public.app_settings` |

## Jornada principal (atendimento — o core do produto)

`Mensagem chega no WhatsApp` → `webhook Zernio/Evolution grava message inbound` → `process-ai-message decide: IA responde OU vai pra fila humana` → `[se IA] resposta automática via RAG` → `[se humano] round-robin atribui a um operador online do departamento` → `operador vê na fila do /inbox` → `responde ou pausa a IA e assume` → `conversa fecha (status='closed') ou segue ativa`

## Jornadas alternativas

- **Handoff manual:** operador clica "Pausar IA" a qualquer momento →
  `ai_paused=true` → notificação para todos operadores do departamento.
- **Cobertura de linha pessoal:** titular de um cargo fica ausente →
  supervisor registra cobertura em Configurações → Setores → mensagens
  novas da linha pessoal roteiam para quem cobre, sem alterar o vínculo
  original; expira sozinho (cron 15min) ou manualmente.
- **Encaminhar contato:** operador encaminha o cadastro (não a conversa)
  para um colega — acesso pontual ao contato, sem transferir a conversa.
- **Follow-up automático:** contato não responde dentro do prazo →
  `check-follow-ups` (cron 15min) enfileira a próxima mensagem da cadeia;
  se o contato responder a qualquer momento, cancela os follow-ups
  restantes.
- **Cancelar/editar campanha:** [A PREENCHER — não encontrei no código uma
  ação explícita de cancelar campanha em andamento; `mass_dispatches` tem
  status `'paused'`, `campaigns` não lista `'paused'` no enum descrito em
  `CLAUDE.md`. Confirmar no `CampaignWizard.tsx`.]

## Regras de navegação

- Sidebar fixa (`AppLayout`/`Sidebar`) — não é navegação por abas com
  histórico próprio; é SPA com rotas do React Router.
- Itens de admin (`canSeeAdminNav`) somem do menu para `supervisor`/
  `operator` — não é só bloqueio de acesso, é ocultação visual.
- `/templates` como rota própria **não existe mais** — qualquer link antigo
  redireciona para `/campaigns?tab=templates`.
- [A PREENCHER] — comportamento do botão "voltar" do navegador dentro do
  Inbox (troca de conversa muda a URL? ) não está documentado.

## Estados vazios e bloqueados

- Componente `EmptyState` existe e foi padronizado no Épico 1 de
  modernização (ver `STATUS.md`) — usado em pelo menos Setor Settings.
  [A PREENCHER] — cobertura de `EmptyState` nas demais telas (Inbox sem
  conversas, Contacts sem contatos, Knowledge sem documentos) não foi
  auditada nesta rodada.
- **Sem permissão:** itens de admin somem do menu (`canSeeAdminNav`); não
  está confirmado se uma rota admin acessada por URL direta por um
  `operator` mostra tela de bloqueio ou redireciona. [A PREENCHER]
- **Sem internet / falha de rede:** [A PREENCHER — não há menção de um
  estado de "offline" dedicado no código revisado].
- **Setup incompleto:** `RequireSetup` força `/setup` até a instância
  terminar o wizard — esse é o único estado "bloqueado" confirmado no
  código.

## Primeiro uso

1. Dono da instância roda o wizard `/setup` (URL + anon key Supabase →
   migrations → Edge Functions → envs Vercel).
2. Primeiro usuário criado em `auth.users` vira `super_admin`
   automaticamente (trigger `handle_new_user`).
3. `super_admin` convida os demais por e-mail (`invite-team-member`),
   definindo papel + departamento (+ linha pessoal Evolution, se aplicável)
   no próprio convite.
4. Convidado aceita em `/invite`, define senha, e (se tinha linha pessoal
   pendente) escaneia o QR da Evolution antes da sessão do link expirar.
5. [A PREENCHER] — existe um onboarding guiado pós-login (tour, checklist)
   além do wizard técnico? `app_settings.onboarding_completed` existe como
   flag, mas não confirmei se há UI de onboarding de produto associada ou
   se é só usado para saber se o wizard técnico já rodou.
