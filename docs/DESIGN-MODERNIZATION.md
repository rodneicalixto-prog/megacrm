# Direção de modernização visual

Para a proposta específica de identidade e acabamento premium do cliente
Athenas, consultar `docs/DESIGN-ATHENAS-PREMIUM.md`. Este documento continua
como diagnóstico estrutural geral do produto.

Auditoria feita em 01/09/2026 por um agente dedicado, sem alterar a experiência
visual nesta entrega de segurança. A direção recomendada é **operational calm**:
menos “glass azul em tudo”, mais hierarquia, superfícies sólidas, densidade
controlada e estados inequívocos.

## P0 — fundação e Equipe

1. Criar superfícies semânticas (`page`, `panel`, `interactive`) e reservar
   blur/glass para overlays, header e drawer. Cards não clicáveis não devem
   ganhar glow no hover.
2. Completar tokens dark/light (`surface`, `border`, `muted`, `disabled`,
   `danger/success/warning`, sombras e focus ring) e remover RGBA/hex azul dos
   componentes.
3. Redesenhar Configurações → Equipe como área administrativa:
   - métricas de ativos, suspensos e convites pendentes;
   - botão “Convidar membro” em dialog/drawer;
   - busca e filtros por papel, setor e status;
   - tabela desktop e cards mobile;
   - badges textuais de status e skeleton/empty state.
4. Trocar os ícones destrutivos lado a lado por menu contextual com ações
   textuais e `AlertDialog`: desativar/reativar, reenviar convite e remover
   permanentemente.

## P1 — kit visual e shell

1. Criar primitivas reutilizáveis: `Select`, `Badge`, `DropdownMenu`,
   `AlertDialog`, `Skeleton`, `EmptyState`, `PageHeader` e `DataTable`.
2. Manter usuário suspenso legível; comunicar estado por badge + texto, não
   reduzindo a opacidade da linha inteira.
3. Reduzir microinterações para 120–180 ms e evitar `transition-all`; respeitar
   `prefers-reduced-motion`.
4. Dar contexto ao header com título/breadcrumb e menu de avatar. Remover
   “Conectado” e o marcador `v0.1 · dev` em produção.
5. Simplificar a marca da sidebar: empresa como identidade principal e
   “Powered by Agentise” discreto, sem glow permanente.

## P2 — navegação e acessibilidade

1. Persistir as seções de Configurações na URL (`/settings/team`) para suportar
   refresh, back/forward e links compartilháveis.
2. Implementar tabs WAI-ARIA ou substituí-las por rotas com
   `aria-current="page"`.
3. Estabelecer piso tipográfico de 12 px para metadados e 14 px para conteúdo;
   reduzir caixa alta e tracking exagerado.
4. Migrar o drawer mobile para uma primitiva acessível com focus trap, Escape,
   `aria-modal` e retorno de foco.
5. Criar `PageContainer` por contexto: formulário, dashboard/tabela e inbox
   full-bleed.

## Sequência de execução

1. Tokens, contraste, motion e superfícies.
2. Primitivas compartilhadas.
3. Nova tela Equipe.
4. Header, sidebar e drawer.
5. Rotas de Configurações e responsividade.
6. Validação dark/light, desktop/mobile, teclado, axe/Lighthouse e WCAG AA.

Cada fase deve ter screenshots de regressão nos dois temas e nos breakpoints
principais. A modernização não deve misturar mudança estética ampla com
alterações de autorização ou migrations de segurança.
