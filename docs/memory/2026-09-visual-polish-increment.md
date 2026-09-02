---
title: Incremento pontual de acabamento visual (pré-fundação Athenas Atelier)
date: 2026-09-02
status: approved
scope:
  - product-design
  - frontend
confidentiality: internal
source_type: product-conversation
---

# Incremento de acabamento visual — 02/09/2026

## Objetivo desta memória

Registrar micro-ajustes visuais aplicados nesta sessão sobre o design system
azul/dark-glass existente, e deixar explícito que eles **não** são a fundação
"Athenas Atelier" descrita em `docs/DESIGN-ATHENAS-PREMIUM.md` — que continua
como proposta não implementada, aguardando ativos reais da marca (logo,
paleta, fontes) porque o ambiente de execução não consegue abrir Instagram
nem o site da Athenas (bloqueio de rede).

## Relação com o plano existente

`docs/DESIGN-MODERNIZATION.md` recomenda **operational calm**: menos glow/glass
generalizado, hierarquia de superfícies semânticas (`page`/`panel`/`card`/
`interactive`/`overlay`), e aplicar efeitos primeiro na Inbox como piloto antes
de propagar. `docs/DESIGN-ATHENAS-PREMIUM.md` reforça o mesmo princípio e
recomenda começar pela fundação de tokens, não por telas soltas.

Os itens implementados nesta sessão **não seguiram essa sequência** — foram
pedidos pontuais ("aplique", "dê uma visual premium") tratados como incremento
rápido sobre o sistema atual, não como início da Fase 0/1 do plano Athenas.
Antes de continuar expandindo efeitos tela a tela, a orientação registrada nos
dois documentos acima continua sendo: fundação de tokens semânticos primeiro,
Inbox como piloto, depois expansão — e cor de marca só entra depois que a
Athenas fornecer hex reais (pedidos ao usuário nesta sessão, ainda não
recebidos).

## O que foi implementado

1. **Micro-interações de botão** (`src/components/ui/button.tsx`,
   `src/styles/globals.css`): ripple no clique e estado `loading` (spinner)
   aplicados por padrão a todo `<Button>`; `.btn-pulse` e `.btn-draw` como
   classes opt-in. Compatível com o requisito do plano Athenas de "seis
   estados documentados" para botões (loading já cobre um deles).
2. **Tipografia de display**: fonte `Fraunces` carregada via Google Fonts e
   aplicada em `.text-display`/`.text-stat` (títulos de página e números de
   dashboard), mantendo Inter no corpo — dentro do que o plano Athenas já
   permitia ("fonte display entra apenas em títulos"), mas sem aprovação da
   marca ainda; é reversível/trocável quando a fonte oficial da Athenas for
   definida.
3. **`.icon-chip`**: badge de ícone com leve gradiente/gloW, substituindo o
   `.glass-card` plano usado nos ícones de cabeçalho de 12 telas
   (Dashboard, Inbox, Funil, Contatos, Campanhas, Disparo em massa,
   Conhecimento, Follow-ups, Configurações, Agenda, Vendas, Agente de IA).
   Ainda usa a paleta azul Agentise — não é a cor da Athenas.
4. **Scroll reveal como "momento de assinatura"**: hooks `useScrollReveal` e
   `useParallax` (`src/hooks/`) + utilitário `[data-animate]` em
   `globals.css`. Aplicado ao cabeçalho de Dashboard, Funil e Inbox (e, no
   Dashboard, em stagger ao painel de atendimento e ao card de uso de IA).
   Respeita `prefers-reduced-motion`.

## Pendências explícitas

- Cores da marca Athenas: usuário confirmou que este deploy é exclusivo da
  Athenas Terceirização e que pode substituir a paleta azul Agentise fixa
  documentada no `CLAUDE.md` ("fixed Agentise brand — no per-tenant
  override in self-hosted") — mas ainda não enviou os hex. `CLAUDE.md`
  **ainda não foi atualizado** para essa exceção; fazer isso só quando os
  hex chegarem, junto da tabela de tokens de marca proposta em
  `DESIGN-ATHENAS-PREMIUM.md`.
- Superfícies semânticas (`page`/`panel`/`card`/`interactive`/`overlay`) da
  Fase 1 do plano Athenas **não foram criadas**. `.glass-card` continua
  aplicando hover/glow a cards não clicáveis em várias telas — o problema
  #1 do diagnóstico em `DESIGN-ATHENAS-PREMIUM.md` segue de pé.
- Nenhuma tela foi migrada como piloto completo (Fase 3 do plano). O que
  existe hoje é polimento pontual, não o kit de componentes premium.

## Próxima ação sugerida

Quando a Athenas enviar logo/paleta/fontes: converter para tokens de marca
(`--brand-primary`, `--brand-accent`, etc.) por cima da fundação de
superfícies semânticas — não direto nos componentes — e então revisitar se
`.icon-chip`, `.text-display`/Fraunces e o scroll-reveal atual continuam
fazendo sentido dentro da direção final aprovada, ou se devem ser
substituídos pelo kit descrito em `DESIGN-ATHENAS-PREMIUM.md`.

## Relações

- Substitui/é substituído por: nenhuma (primeira entrada sobre este tópico).
- Documentos relacionados: `docs/DESIGN-MODERNIZATION.md` (proposed),
  `docs/DESIGN-ATHENAS-PREMIUM.md` (proposta, sem implementação visual),
  `docs/memory/2026-09-platform-quality-security-ai.md` (seção
  "Modernização visual").
