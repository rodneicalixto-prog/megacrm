# Issues conhecidas

> Rastreamento local. Com o repositório já em um remoto GitHub, cada entrada
> aqui deve virar uma issue real — este arquivo é o backlog enquanto isso não
> acontece.

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

## Migration drift — RLS de `contacts`/`products` e `handle_new_user()` corrigidos direto em produção

- **Status:** aberta — falta a migration retroativa.
- **Severidade:** 🟡 moderate (risco de processo, não de segurança em si).
- **O que foi relatado:** numa sessão de investigação anterior (fora deste
  repositório, via chat), foram aplicadas diretamente no Supabase de
  produção: uma correção de RLS em `contacts`/`products`, uma correção na
  trigger `handle_new_user()`, e a remediação manual de 4 usuários com role
  errada.
- **Não verificado nesta sessão.** Este agente não tem acesso direto ao
  banco de produção para confirmar o que exatamente mudou — o relato acima é
  de terceiros. Não há nenhuma migration em `supabase/migrations/` datada
  depois de `20260822170000_meetings.sql` que corresponda a essas mudanças.
- **Risco:** se as alterações ficaram só em produção (via SQL editor /
  MCP do Supabase), o schema de produção diverge do que `npm run db:push`
  reconstruiria do zero — um ambiente novo (ou o próprio wizard `/setup` em
  outra instância) não teria a correção. Precisa: (1) confirmar o diff real
  em produção (`list_migrations`/`execute_sql` contra `pg_policies` e a
  definição da function), (2) escrever a migration equivalente e commitar,
  (3) só então fechar esta entrada.

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

## Tenants fantasmas no banco

- **Status:** aberta, sem ação planejada.
- **Severidade:** 🟢 baixa — relatado como "lixo inofensivo", sem impacto
  funcional conhecido.
- **O que se sabe:** existem registros de tenants órfãos/antigos sobrando no
  Supabase, herança provável da migração SaaS → self-hosted (uma instância =
  uma organização). Não foi investigado ainda de que tabela(s) vêm nem se
  algum RLS/RPC assume tenant único de um jeito que esses registros
  invalidam.
- **Próximo passo:** mapear a origem (provavelmente uma tabela remanescente
  do modelo multi-tenant antigo) antes de decidir entre limpar ou apenas
  documentar como legado inofensivo.

## Schema `public` com outros sistemas Agentise no mesmo Supabase

- **Status:** aberta, não investigada.
- **Severidade:** desconhecida — depende do que exatamente está lá.
- **O que se sabe:** o mesmo projeto Supabase hospeda múltiplas apps
  Agentise por schema (ver seção "Arquitetura multi-schema" do
  `CLAUDE.md`: `agentise_chat`, `prospector`, `crm_sofia`, `whatsapp_hub`).
  Foi identificado que o schema `public` — que deveria ficar reservado a
  extensions e ao cofre de credenciais/bootstrap (`public.app_settings`,
  `public._bootstrap_state`) — tem outros sistemas misturados nele. Ainda
  não foi levantado quais tabelas são essas, se há RLS cobrindo-as, ou se
  há risco de colisão de nomes com o que este projeto já usa em `public`.
- **Próximo passo:** `list_tables` no schema `public` em produção pra ver o
  que exatamente está lá além de `app_settings`/`_bootstrap_state`, e
  decidir se precisa de isolamento adicional.
