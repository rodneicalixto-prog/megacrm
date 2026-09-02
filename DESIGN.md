# MegaCRM (WhatsApp Hub / Agentise) Design System

> Gerado pelo skill `design-brief` a partir de **análise do projeto existente**,
> não de um brief novo. O megacrm é um app interno (dashboard/CRM com
> sidebar), não uma landing page — o vocabulário fechado do skill (hero,
> sections=pricing/testimonials, layout=single_column/two_column) foi
> pensado pra marketing site. Onde o valor real do projeto não existe nesse
> vocabulário, documentei o valor real e sinalizei o "sem mapeamento direto"
> em vez de forçar um encaixe. Ver seção 9 (Dimensões fora do vocabulário
> fechado) no final.

## Visual Theme & Atmosphere
- Mood real: **dark tech glassmorphism** — não é `professional_minimal` puro
  (que pressupõe pouco ornamento); há glow azul, blur e bordas luminosas
  deliberados em cards e botões. Mais próximo de um meio-termo entre
  `professional_minimal` e um estilo "tech/SaaS operacional".
- Feel: confiante, "operação em tempo real", com toques de premium (glow,
  glass, ripple) sobre uma base funcional densa (tabelas, filas, filtros).
- Direção futura já proposta (não implementada): **"operational calm"**
  (`docs/DESIGN-MODERNIZATION.md`) — reduzir glow/glass permanente em favor
  de hierarquia e superfícies sólidas. E **"Athenas Atelier"**
  (`docs/DESIGN-ATHENAS-PREMIUM.md`) — identidade B2B de cosméticos com
  precisão editorial, pendente dos ativos reais da marca Athenas
  Terceirização (logo/paleta/fontes ainda não recebidos).
- Referências citadas nos planos existentes: nenhuma explícita ainda (Fase 0
  do plano Athenas prevê moodboard após receber ativos da marca).

## Color Palette & Roles
Paleta real (`src/styles/globals.css`), mais próxima do símbolo
`monochrome_dark` do skill, mas com tonalidade azul embutida no fundo e nas
bordas em vez de neutro puro — variante custom, não um dos 4 valores do
vocabulário fechado:

| Papel | Token | Valor |
|---|---|---|
| Background | `--color-bg-primary` | `#0A0A0F` (+ radial glow azul sutil no `body`) |
| Surface (glass) | `--color-bg-card` / `--surface` | `rgba(15, 18, 35, 0.6)` |
| Text primary | `--color-text-primary` | `#F8FAFC` |
| Text secondary | `--color-text-secondary` | `#94A3B8` |
| Accent | `--accent-primary` | `#3B82F6` — **coincide exatamente** com o token `accent=electric_blue` do skill |
| Accent secondary/hover | `--accent-secondary` | `#60A5FA` (hover real usa glow/brightness, não troca de matiz como o skill assume) |
| Success | `--color-success` | `#10B981` |
| Error | `--color-error` | `#EF4444` |
| Border padrão | `--color-border-card` | `rgba(59, 130, 246, 0.25)` (dark) / `rgba(37, 99, 235, 0.2)` (light) |

Tema claro existe em paralelo (`:root[data-theme='light']`), não previsto no
modelo do skill (que assume um único tema por brief).

**Nota de rebrand pendente:** esta instância é exclusiva da Athenas
Terceirização e vai trocar essa paleta azul por cores da marca assim que os
hex forem enviados (`CLAUDE.md`, callout de 02/09/2026). Esta tabela reflete
o estado **atual**, não o final.

## Typography Rules
- Display: **Fraunces**, 600, `letter-spacing: -0.01em` — valor fora do
  vocabulário fechado do skill (`space_grotesk`/`clash_display`/`playfair`/
  `same_as_body`); mais próximo conceitualmente de `playfair` (serifa
  editorial), mas é literalmente Fraunces, carregada via Google Fonts.
  Usada só em `.text-display`/`.text-stat` (títulos de página e números de
  dashboard) — igual à regra do skill de reservar a fonte display a
  títulos/momentos de marca.
- Body: **Inter**, 400 — mapeia exato para `typography=inter`.
- Mono: não há fonte monoespaçada declarada no projeto hoje (nenhum
  `font-mono`/JetBrains Mono encontrado). Dimensão sem valor real — se
  necessária no futuro (ex: exibir JSON de payload de webhook), a
  recomendação do skill (`JetBrains Mono`) é uma escolha segura por não
  colidir com Inter/Fraunces.
- `.text-stat`: 2.5rem, 700, `letter-spacing: -0.02em`, `tabular-nums` —
  números de dashboard, adicionado nesta sessão.

## Component Stylings
- Botões (`src/components/ui/button.tsx`): `rounded-lg` (não
  `rounded-full`/`rounded-md` puro do skill — meio-termo), 6 variantes
  (default/secondary/ghost/outline/destructive/link) + `loading` (spinner)
  e ripple no clique por padrão. `.btn-pulse`/`.btn-draw` como opt-in.
- Cards (`.glass-card`): fundo translúcido + blur 40px, borda azul 25%,
  glow no hover — **todo** `.glass-card` reage no hover hoje, inclusive
  blocos não clicáveis. Isso é apontado como problema #1 no diagnóstico de
  `DESIGN-ATHENAS-PREMIUM.md`, ainda não corrigido.
- `.icon-chip` (novo, badge de ícone de cabeçalho): gradiente azul 22%→6%,
  borda 32%, glow 24px — usado em 12 telas.
- Inputs: `bg-[var(--color-bg-elevated)]`, borda azul 25%, foco muda cor da
  borda — sem "borda grossa" (brutalist) nem "transparente com underline"
  puro do skill; é um meio-termo com fundo sólido elevado.

## Layout Principles
- **Sem mapeamento direto** para `single_column`/`two_column`/`asymmetric`
  do skill: o app usa **shell fixo** (sidebar de navegação + header + área
  de conteúdo), com cada rota decidindo seu próprio grid interno (ex: Inbox
  é 3 colunas — filas/lista/thread; Funil é kanban horizontal; Dashboard é
  cards em grid responsivo).
- Max width por tela: a maioria usa `max-w-7xl` (~1280px) centralizado;
  Funil e Inbox usam `max-w-full`/altura fixa (`h-[calc(100vh-6rem)]`).
- Section spacing: `space-y-6` (24px) entre blocos principais — mais
  próximo de `density=compact`/`balanced` do que `spacious` (96px).
- Content padding: cards `p-4`/`p-6` (16–24px), controles `px-3 py-2`.

## Depth & Elevation
- Shadows: glow colorido (`box-shadow` com `rgba(59,130,246,*)`), não sombra
  neutra — foge das 3 opções do skill ("hard offset"/"none"/"subtle sm").
  `dashboard-interactive-card` tem elevação real no hover
  (`translateY(-3px)` + sombra + glow radial); cards estáticos não deveriam
  ter isso, mas `.glass-card` puro ainda aplica glow a todos.
- Borders: `rgba(59, 130, 246, 0.12)` padrão, `0.08` para dividers — sempre
  tingidas de azul, nunca neutras puras.

## Do's and Don'ts
- DO usar os tokens `var(--accent-primary)`/`var(--accent-secondary)` em vez
  de hardcodear `#3B82F6`/`#60A5FA` (regra já existente no `CLAUDE.md`).
- DO manter `.text-display`/`.text-stat` como os únicos usos de Fraunces.
- DO respeitar `prefers-reduced-motion` em qualquer animação nova (padrão já
  seguido em `.icon-chip`, ripple, scroll-reveal).
- DON'T aplicar `.glass-card` a blocos não clicáveis esperando que pareçam
  estáticos — hoje ele sempre reage no hover (dívida técnica conhecida).
- DON'T inventar cor de marca antes de os hex reais da Athenas chegarem —
  documentar em `docs/DESIGN-ATHENAS-PREMIUM.md`/`CLAUDE.md` quando acontecer.
- DON'T misturar mais fontes de display além de Fraunces sem atualizar este
  arquivo e o `CLAUDE.md`.

## Responsive Behavior
- Breakpoints reais (Tailwind v4 padrão): `sm`(640px)/`md`(768px)/
  `lg`(1024px)/`xl`(1280px) — coincide com o default do skill.
- Mobile: sidebar principal e filtros colapsam (`sm:flex-row` reverte pra
  coluna); Inbox e Funil não têm um layout mobile dedicado documentado —
  gap a validar.
- Não há evidência de "mobile first" explícito no CSS (a maioria dos
  componentes é `flex-col sm:flex-row`, ou seja, mobile é o estado base por
  padrão do Tailwind, mas sem revisão dedicada de UX mobile).

## Agent Prompt Guide
- Não inventar cores fora da tabela acima até a paleta Athenas chegar.
- Não adicionar `box-shadow` genérico — usar sempre o padrão de glow azul
  (`rgba(59,130,246,*)`) ou, se for a superfície `interactive` proposta em
  `DESIGN-ATHENAS-PREMIUM.md`, seguir aquele documento em vez de inventar.
- Cor de acento (`--accent-primary`) não deve dominar mais de ~3 elementos
  por tela (título, CTA primário, 1 destaque) — hoje ela aparece em bordas
  de quase todo componente, o que é uma das críticas já registradas.
- Todo elemento interativo precisa de `:focus-visible` (já garantido
  globalmente em `globals.css`, não remover essa regra).
- Fraunces só em `.text-display`/`.text-stat` — nunca em corpo de texto.
- Antes de propagar qualquer efeito novo pra mais telas, checar
  `docs/DESIGN-MODERNIZATION.md` e `docs/DESIGN-ATHENAS-PREMIUM.md`: a
  direção documentada é reduzir glow espalhado, não aumentar.

---

## Dimensões fora do vocabulário fechado do skill

| Dimensão | Valor real do projeto | Por que não mapeia |
|---|---|---|
| `palette` | Dark navy-tinted (#0A0A0F + glass azul) | Mais perto de `monochrome_dark`, mas com tingimento azul estrutural — não é neutro puro |
| `display` | Fraunces | Não está entre `space_grotesk`/`clash_display`/`playfair`/`same_as_body` |
| `layout` | App shell (sidebar + conteúdo, grids por rota) | O skill assume página de marketing de rolagem única |
| `mood` | Dark tech glassmorphism | Fica entre `professional_minimal` e algo mais ornamentado (glow/blur) |
| `mono` | Nenhuma definida | Dimensão não coberta pelo projeto hoje |

Nenhum default do skill foi aplicado às cegas — cada linha acima documenta o
valor real observado no código, não uma suposição.
