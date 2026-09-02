# Plano de experiência premium para Athenas

## Status e limites da referência

**Status:** proposta para validação, sem implementação visual nesta etapa.

**Referências fornecidas:**

- `https://www.instagram.com/athenasterceirizacao/`;
- `https://athenascosmeticos.com.br/`.

O ambiente de execução não conseguiu abrir as duas referências por bloqueio de
rede. Por isso, este plano não inventa cores, fontes ou elementos da marca. A
paleta final depende da coleta do logotipo vetorial, manual da marca, fontes,
fotografias autorizadas e capturas das páginas de referência.

## Diagnóstico do acabamento atual

O frontend já tem tema claro e escuro, tokens básicos, bordas arredondadas,
blur e glow. Isso cria consistência mínima, mas não produz acabamento premium
porque quase toda superfície recebe o mesmo tratamento visual.

Os principais problemas são:

1. `.glass-card` aplica hover e glow a qualquer card, inclusive blocos que não
   são clicáveis. O movimento deixa de comunicar ação.
2. A transição global de 400 ms em `transition: all` dá sensação lenta e pode
   animar propriedades que não deveriam se mover.
3. Azul Agentise, RGBA azul e branco translúcido aparecem diretamente em muitos
   componentes. Uma troca de identidade visual fica incompleta e inconsistente.
4. Cards, painéis, campos e menus têm pouca diferença de elevação. Falta uma
   hierarquia clara entre fundo, conteúdo, ação e overlay.
5. Labels muito pequenas, caixa alta e tracking amplo funcionam como detalhe,
   mas foram usadas em excesso.
6. O Inbox concentra muitas bordas e controles pequenos. A operação fica densa,
   enquanto as ações prioritárias não ganham presença suficiente.
7. Não existe um padrão completo para estados de botão, card interativo,
   skeleton, vazio, sucesso, erro e carregamento.

## Princípio de direção

O modelo recomendado é **Athenas Atelier**: uma interface B2B de cosméticos com
precisão industrial, cuidado de laboratório e apresentação editorial. O premium
vem de proporção, tipografia, contraste, material e resposta tátil; glow e
gradiente entram apenas onde ajudam a hierarquia.

O modelo deve transmitir:

| Atributo | Tradução na interface |
|---|---|
| Confiança | superfícies limpas, alinhamento rigoroso e estados explícitos |
| Sofisticação | tipografia editorial nos títulos e espaços mais bem calibrados |
| Tecnologia | microinterações rápidas, foco visível e feedback imediato |
| Cosméticos | detalhes de cor da marca, imagens com tratamento consistente e formas suaves |
| Operação | alta legibilidade, densidade controlada e ações previsíveis |

## Modelo visual proposto

### 1. Arquitetura de superfícies

Em vez de um único card de vidro, o sistema terá cinco níveis semânticos:

| Nível | Uso | Material |
|---|---|---|
| `page` | fundo geral | cor sólida com textura ou halo muito discreto |
| `panel` | Inbox, tabelas e formulários | superfície sólida, borda suave e sombra curta |
| `card` | agrupamento informativo | superfície elevada sem hover automático |
| `interactive` | item clicável | borda e elevação reativas, deslocamento máximo de 1 px |
| `overlay` | modal, menu e drawer | blur controlado, sombra profunda e backdrop |

Cards estáticos não devem brilhar ao passar o mouse. Cards interativos recebem
um halo curto, borda da marca e elevação pequena. Isso preserva o efeito premium
porque ele aparece somente quando tem significado.

### 2. Tokens de marca

Após receber os ativos da Athenas, a identidade deve ser convertida para tokens,
sem espalhar hexadecimais nos componentes:

```css
:root {
  --brand-primary: <cor principal validada>;
  --brand-primary-hover: <variação de hover>;
  --brand-accent: <cor de destaque validada>;
  --brand-ink: <cor escura da marca>;
  --brand-soft: <fundo tonal claro>;

  --surface-page: <fundo da aplicação>;
  --surface-panel: <painel principal>;
  --surface-card: <card elevado>;
  --surface-interactive: <controle interativo>;
  --surface-overlay: <modal e menu>;

  --border-subtle: <divisor>;
  --border-default: <borda padrão>;
  --border-strong: <borda ativa>;

  --shadow-card: <sombra curta>;
  --shadow-float: <sombra de menu>;
  --shadow-dialog: <sombra de modal>;
  --ring-brand: <anel de foco acessível>;
}
```

Os temas claro e escuro devem compartilhar a mesma intenção sem inverter cores
automaticamente. Cada tema precisa de superfícies e contrastes validados.

### 3. Tipografia

Até a marca informar as fontes oficiais, a aplicação mantém Inter no corpo. O
upgrade tipográfico deve criar papéis claros:

- título de página entre 28 e 32 px, peso 650 a 700;
- título de seção entre 18 e 22 px;
- corpo operacional em 14 px;
- metadado com piso de 12 px;
- número de dashboard com desenho tabular;
- label em caixa alta somente para categorias curtas.

Se a Athenas usar uma fonte display licenciada, ela entra apenas em títulos e
momentos de marca. Conteúdo operacional continua com uma sans legível.

### 4. Botões com acabamento premium

O kit terá cinco variantes:

| Variante | Uso | Efeito |
|---|---|---|
| Primário | ação principal da tela | gradiente tonal da marca, highlight superior e sombra curta |
| Secundário | ação alternativa | superfície elevada, borda e hover tonal |
| Ghost | ações locais | fundo aparece no hover, sem sombra |
| Destrutivo | exclusão e cancelamento grave | cor de erro, confirmação e texto explícito |
| Icon button | ferramentas compactas | área mínima de 40 px, tooltip e estado pressionado |

Estados obrigatórios: default, hover, active, focus-visible, disabled e loading.
O hover dura entre 140 e 180 ms. No active, o botão desce 1 px e reduz a sombra.
O loading preserva a largura para evitar deslocamento do layout.

### 5. Cards e métricas

Cards de dashboard terão borda tonal fina, sombra curta e uma faixa de destaque
opcional. O número é protagonista; ícone, rótulo e comparação ficam
subordinados. O hover só aparece quando o card abre um detalhamento.

Cards de configuração permanecem estáticos. Cards de seleção usam estado
selecionado inequívoco com borda, ring e check. Cards de alerta usam cor
semântica em uma área pequena, sem colorir o bloco inteiro.

### 6. Motion e feedback

As animações devem reforçar causalidade:

- hover e press: 140 a 180 ms;
- menus e popovers: 160 a 200 ms;
- drawer: 220 a 260 ms;
- modal: fade e scale de 0,98 para 1 em até 220 ms;
- skeleton com shimmer sutil;
- nova mensagem com entrada curta, sem mover o histórico inteiro;
- `prefers-reduced-motion` remove deslocamentos e mantém apenas feedback de cor.

Não usar animação contínua em cards, logo ou sidebar. Brilho permanente reduz a
percepção de qualidade e aumenta ruído durante o atendimento.

## Aplicação por área

### Shell, sidebar e header

- substituir a moldura genérica por sidebar sólida com identidade Athenas;
- usar logotipo principal e assinatura “Tecnologia Agentise” em segundo plano;
- destacar rota ativa com indicador lateral, fundo tonal e texto de alto
  contraste;
- transformar o header em barra contextual com breadcrumb, busca opcional e
  menu do usuário;
- reservar vidro para o header flutuante ou overlays, se a identidade aprovar.

### Inbox

- reduzir a quantidade de bordas entre filas, lista e conversa;
- usar seleção de conversa com faixa lateral da marca e fundo tonal;
- elevar os cinco contatos fixados em uma seção compacta de acesso rápido;
- transformar “Grupos” em coleção recolhível com contador e menu contextual;
- dar presença ao campo de mensagem com superfície própria e botões de ícone
  padronizados;
- usar bolhas com largura, raio e contraste distintos para contato, operador,
  IA e nota privada;
- apresentar ações da conversa em uma barra limpa, evitando ícones soltos.

### Dashboard

- criar um hero operacional curto com saudação, período e principal ação;
- adotar grid consistente de métricas com variação máxima de dois tamanhos;
- padronizar gráficos com paleta da marca e contraste acessível;
- mover filtros para uma toolbar comum;
- usar empty states ilustrados somente quando houver orientação útil.

### Contatos, funil e tabelas

- usar toolbar única para busca, filtros, exportação e ação primária;
- aplicar header fixo e linhas com hover discreto;
- exibir ações secundárias em menu contextual;
- usar avatar ou monograma consistente;
- padronizar tags, status, origem e prioridade com badges semânticos;
- no funil, diferenciar coluna, card arrastável e item selecionado por elevação.

### Configurações

- substituir a sequência de cards iguais por navegação lateral e seções;
- agrupar credenciais por provedor e mostrar estado de saúde;
- usar resumo visual para setor, linha e cobertura;
- reservar alertas fortes para falha real, evitando excesso de amarelo/vermelho.

## Protótipo de referência

O primeiro protótipo deve cobrir quatro frames no Figma ou em uma rota de
storybook interna:

1. Inbox desktop no tema principal, com conversa ativa, favoritos e grupos.
2. Dashboard desktop, com hero, métricas, gráfico e tabela curta.
3. Contatos mobile, com filtros e ação de encaminhar.
4. Configurações desktop, com setor, linha Evolution e estado de conexão.

Cada frame precisa demonstrar botão primário, botão secundário, icon button,
card estático, card interativo, badge, campo, menu, loading, vazio e erro.

## Plano de execução

### Fase 0: imersão de marca, 0,5 a 1 dia

- receber logo SVG, paleta, fontes e fotos autorizadas;
- capturar site e Instagram em desktop e mobile;
- identificar elementos recorrentes e restrições de uso;
- aprovar um moodboard com uma direção principal e uma alternativa.

**Saída:** brand brief de uma página e tokens preliminares.

### Fase 1: fundação, 1 a 2 dias

- criar tokens semânticos para marca, superfície, borda, sombra e motion;
- separar `glass-card`, `surface-card` e `interactive-card`;
- remover `transition-all` das primitivas;
- validar contraste nos dois temas;
- adicionar Storybook ou uma rota protegida de showcase.

**Saída:** playground aprovado de componentes.

### Fase 2: kit premium, 2 a 3 dias

- refazer Button, Card, Input, Select, Badge, Dropdown, Dialog e Skeleton;
- criar PageHeader, Toolbar, EmptyState, StatCard e DataTable;
- documentar estados, tamanhos e uso correto;
- gerar screenshots de regressão.

**Saída:** biblioteca reutilizável pronta para as telas.

### Fase 3: Inbox piloto, 2 a 3 dias

- aplicar shell, filas, grupos, favoritos, lista, thread e composer;
- testar conversas extensas e diferentes tipos de mensagem;
- validar desktop, tablet, celular, claro, escuro, teclado e motion reduzido;
- colher aprovação do cliente antes de propagar o padrão.

**Saída:** Inbox como tela de referência visual.

### Fase 4: expansão, 4 a 7 dias

- migrar Dashboard, Contatos, Funil, Agenda e Configurações;
- eliminar cores e sombras hardcoded encontradas durante a migração;
- preservar fluxos e autorização, sem misturar redesign com regras de negócio;
- revisar consistência ao final de cada módulo.

**Saída:** aplicação completa no novo sistema.

### Fase 5: acabamento e aceite, 1 a 2 dias

- executar revisão visual em breakpoints principais;
- testar WCAG AA, foco, zoom 200%, loading, vazio, erro e conteúdo longo;
- avaliar desempenho de blur, sombras e gráficos em máquina intermediária;
- fechar checklist junto ao cliente.

**Saída:** release candidate com evidências de aceite.

## Critérios objetivos de aceite

1. Nenhum componente novo usa hex ou RGBA da marca fora dos arquivos de token.
2. Todo botão possui seis estados documentados e foco visível.
3. Card estático não reage como elemento clicável.
4. Transições de interação ficam entre 140 e 260 ms.
5. Interface respeita `prefers-reduced-motion`.
6. Temas claro e escuro atingem contraste WCAG AA para texto e controles.
7. Inbox funciona em 360, 768, 1280 e 1440 px sem ação inacessível.
8. Screenshots cobrem estados padrão, loading, vazio e erro.
9. O cliente aprova a Inbox piloto antes da expansão para os outros módulos.
10. A identidade Athenas permanece configurável por tokens, sem fork visual do
    código de produto.

## Insumos necessários do cliente

- logotipo principal e versões monocromáticas em SVG;
- manual ou paleta oficial com códigos de cor;
- arquivos das fontes e licenças de uso;
- fotografias autorizadas, preferencialmente em alta resolução;
- indicação do tema prioritário, claro ou escuro;
- exemplos de marcas que o cliente considera premium;
- aprovação sobre uso de “Tecnologia Agentise” na sidebar e no login.

## Recomendação

Começar pela fundação e usar a Inbox como piloto. Aplicar efeitos diretamente
em todas as telas agora aumentaria a inconsistência já existente. O ganho premium
virá primeiro da hierarquia de superfícies e do kit de componentes; depois, os
efeitos de marca podem ser adicionados com controle e repetidos sem retrabalho.
