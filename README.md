> ⚠️ **ARQUIVADO — Consolidação WhatsApp/CRM (18/09/2026)**
>
> Este repositório foi **descontinuado** na consolidação dos hubs WhatsApp do ecossistema.
>
> - **Hub SaaS canônico:** SmartZap (WhatsApp + IA multi-provider, mem0, multi-tenant).
> - **Canal WhatsApp único:** Evolution API.
> - **Motivo do arquivamento:** redundante com super_calixto_crm — mesmo Agentise WhatsApp Hub (Zernio→Meta), rota legada.
>
> Histórico preservado apenas para referência — nenhuma feature nova neste repositório.

---

# Agentise WhatsApp Hub

Plataforma self-hosted de automacao WhatsApp para uma unica organizacao:
templates assistidos por IA, campanhas em massa, inbox em tempo real,
handoff IA/humano, RAG e dashboard operacional.

A comunicacao com o WhatsApp passa pelo **Zernio** (intermediario que relaya
para a Meta Cloud API): o aluno conecta o WhatsApp no Zernio (Embedded Signup,
poucos cliques) e informa apenas a `ZERNIO_API_KEY` no wizard — sem coletar
WABA ID, tokens ou App Secret da Meta.

## Stack

- Frontend: React 18, Vite, TypeScript, Tailwind, shadcn/ui.
- Backend: Supabase Postgres, Auth, Realtime, Edge Functions, Storage, pgvector, pg_cron e pg_net.
- WhatsApp: Zernio (API oficial) e Evolution API v2 (nao-oficial, self-hosted).
- Deploy: Vercel.

## Rotas de WhatsApp

Duas rotas coexistem e sao individualmente opcionais — o wizard so exige que
**pelo menos uma** esteja configurada.

| Rota | Credenciais | Atribuicao CTWA |
|---|---|---|
| Zernio — oficial, via Meta Cloud API | `zernio_api_key` | sim (`ctwa_clid`) |
| Evolution API v2 — nao-oficial, self-hosted | `evolution_server_url`, `evolution_api_key`, `evolution_instance` | codigo de rastreio |

Cada conversa responde pela rota por onde a mensagem chegou: o `channel` da
conversa guarda o nome do provider.

### Webhook da Evolution API

O CRM gera uma URL protegida para a Edge Function `whatsapp-inbound`. Ela inclui
um token aleatorio associado a instalacao; nao monte nem publique a URL
manualmente.

Evento necessario: `MESSAGES_UPSERT`. O registro pode ser feito automaticamente
pelo wizard `/setup` ou por Configuracoes → Credenciais, que chamam
`POST /webhook/set/{instance}` na Evolution usando a URL segura retornada pela
API administrativa.

## Setup Para Alunos

1. Acesse o painel Agentise e siga o fluxo para criar sua copia do template.
2. Importe o projeto na Vercel.
3. Abra a URL deployada e siga o wizard em `/setup`.

O wizard coleta as credenciais, roda migrations, deploya Edge Functions,
configura as envs core na Vercel e salva as credenciais de aplicacao
criptografadas no Supabase da propria instancia.

Mais detalhes ficam no painel Agentise.

## Credenciais

Em producao, somente quatro envs core existem na Vercel:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRYPTO_KEY=
```

Credenciais de aplicacao, como a Zernio API Key (WhatsApp), OpenAI, Anthropic e
Gemini, nao ficam em `.env` nem em Supabase secrets. Elas sao gerenciadas por
`/settings/credentials` e persistidas criptografadas em `public.app_settings`,
a unica fonte de verdade. Todo o codigo as le pelo acessador `getCredential`
(`src/lib/credentials.ts` no Node, `supabase/functions/_shared/credentials.ts`
no Deno); `tenant-credentials.ts` e apenas um wrapper tipado sobre ele.

Nao delete `CRYPTO_KEY` da Vercel. Sem ela, os valores criptografados em
`public.app_settings` nao podem ser recuperados.

## Convite de Equipe

Admins convidam por e-mail via `invite-team-member`. Para supervisor/operador
o convite pode trazer cargo + linha pessoal da Evolution (setor especifico,
cargo e instancia informados juntos; falha em qualquer etapa desfaz o convite).

No aceite (`/invite`), `accept-team-invite` consome o convite e define a senha.
Se a pessoa tem linha pendente, a sessao do link segue viva so o tempo de ela
escanear o QR (`/api/evolution-instance`, permitido a admin ou ao dono da
linha) e `finalize-team-invite` a revoga. Sem linha pendente, a sessao e
revogada no proprio aceite.

## Desenvolvimento Local

```bash
npm install
npm run dev
```

Para testar bootstrap real, use uma instancia Supabase e Vercel descartavel,
pois o wizard aplica migrations, deploya Edge Functions e dispara redeploy.

## Estrutura

```text
api/                         Vercel Serverless Functions
src/app/routes/setup/        Wizard /setup
src/app/routes/settings/     Credenciais e configuracoes internas
src/components/credentials/  Campo reutilizavel de credenciais
src/lib/credentials.ts       Criptografia server-side
supabase/functions/          Edge Functions
supabase/migrations/         Migrations SQL
setup.config.ts              Manifesto de credenciais da ferramenta
```

## Licenca

MIT.
