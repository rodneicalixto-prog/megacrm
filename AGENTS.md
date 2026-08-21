# AGENTS.md — WhatsApp Hub (Agentise)

> **Fonte de verdade da arquitetura deste projeto é `CLAUDE.md`**, na raiz
> deste repositório. Leia-o primeiro — ele descreve a stack real (Zernio +
> Evolution API v2 coexistindo, não só Meta Cloud API), o schema do banco, os
> 4 papéis (`super_admin`/`admin`/`supervisor`/`operator`) e departamentos, a
> lista completa de Edge Functions, os jobs `pg_cron`, convenções de código e
> o design system.
>
> Este arquivo `AGENTS.md` existe só porque algumas ferramentas de agente
> procuram esse nome por convenção. Ele deixou de duplicar o conteúdo de
> `CLAUDE.md` porque essa duplicação foi exatamente o que causou a
> divergência encontrada no code review de 21/08/2026 — `AGENTS.md` ainda
> descrevia Meta Cloud API pura, 2 papéis, funções renomeadas/removidas
> (`meta-webhook`, `check-template-status`, `test-meta-connection`) e um
> design system "dark mode only, sem toggle" que já não é verdade (o app
> ganhou seletor de tema — ver `CHANGELOG.md`). Manter duas fontes da mesma
> informação sempre diverge; manter uma só e apontar pra ela não.
