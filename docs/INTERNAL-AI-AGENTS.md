# Agentes internos por setor e memória organizacional

## Decisão

É viável e combina com a arquitetura atual, mas deve ser um módulo separado do
agente de atendimento. O agente interno conversa com colaboradores autenticados,
usa conhecimento e memória do setor e nunca envia mensagens para contatos do
WhatsApp/Instagram.

O projeto já oferece peças reutilizáveis:

- departamentos e quatro níveis hierárquicos;
- chat interno 1:1;
- adapter multi-LLM;
- embeddings OpenAI e pgvector;
- upload, chunking e RAG;
- múltiplos perfis/versionamento de prompt e observabilidade.

Não se deve apenas adicionar `department_id` ao agente atual. O pipeline
`process-ai-message` foi desenhado para conversas com leads, handoff e envio por
provedor WhatsApp. Reutilizar o adapter LLM, embeddings e componentes é correto;
reutilizar as tabelas, triggers e pipeline de atendimento criaria acoplamento e
risco de uma resposta interna sair por um canal externo.

## Experiência proposta

Cada setor pode ter um ou mais agentes, por exemplo:

- **RH** — políticas internas, onboarding, briefing, recrutamento e dúvidas;
- **Comercial** — playbooks, objeções, propostas e análise de pipeline;
- **Operações** — procedimentos, incidentes, checklists e retrospectivas;
- **Projetos** — brainstorming, escopo, riscos, decisões e documentação.

Na navegação, “Assistentes internos” abre uma área semelhante a um workspace:

1. seletor do agente/setor;
2. conversa com streaming e citações das fontes;
3. painel lateral “Memória relacionada”;
4. ações explícitas “propor memória”, “criar nota”, “vincular projeto” e
   “solicitar revisão”;
5. busca unificada com filtros de setor, tipo, período, pessoa e projeto.

O agente nunca deve gravar tudo automaticamente como verdade. Ao final de uma
conversa ele propõe fatos, decisões, pendências e aprendizados; um humano aprova
o que vira memória canônica.

## Modelo de agentes e skills

### `internal_agents`

- `id`, `department_id`, `name`, `description`, `avatar`;
- `system_prompt`, `model`, `temperature`, `max_tokens`;
- `is_active`, `created_by`, `updated_at`;
- `visibility`: setor, usuários selecionados ou administração;
- `memory_policy_id` e `knowledge_scope_id`.

### `internal_agent_skills`

Skills devem ser capacidades registradas e allowlisted, não código arbitrário
escrito pelo usuário. Exemplos:

- `draft_policy`, `summarize_meeting`, `create_briefing`;
- `brainstorm_project`, `compare_candidates`, `build_checklist`;
- `search_internal_memory`, `create_memory_proposal`;
- integrações futuras de agenda/tarefas sempre com confirmação humana.

Cada execução registra agente, skill, usuário, entradas referenciadas, resultado,
latência e aprovação. Skills que produzem comunicação oficial, medida
disciplinar, parecer trabalhista, decisão de contratação/desligamento ou acesso
a dado sensível nunca executam uma ação final automaticamente.

## Memória “estilo Obsidian”

O melhor desenho não é uma segunda base vetorial que acumula todas as conversas.
É uma memória em grafo com três camadas:

1. **Memória de sessão** — contexto curto da conversa atual; expira rapidamente.
2. **Memória episódica** — resumos de reuniões/conversas, decisões e ocorrências,
   com fonte, participantes, data, validade e nível de confidencialidade.
3. **Memória canônica** — políticas, procedimentos, projetos e fatos revisados;
   só esta camada é tratada como fonte institucional confiável.

### Estruturas sugeridas

- `memory_spaces`: setor, projeto ou espaço restrito;
- `memory_notes`: Markdown, título, tipo, status, autor, revisor, validade,
  classificação e conteúdo criptografado quando necessário;
- `memory_links`: relações tipadas (`relacionado_a`, `decidido_em`,
  `substitui`, `contradiz`, `depende_de`);
- `memory_chunks`: embedding e trecho para recuperação;
- `memory_sources`: mensagem, reunião, arquivo ou URL que fundamenta a nota;
- `memory_acl`: usuário/papel/departamento e permissão;
- `memory_revisions`: histórico imutável de alterações;
- `memory_access_log`: leitura, busca, exportação e uso pelo agente;
- `memory_retention_rules` e `legal_holds`.

Toda resposta deve apresentar links para notas/fontes, data da informação e um
aviso quando houver conteúdo contraditório ou vencido. Embeddings ajudam a
encontrar contexto; não determinam autorização nem transformam um texto em
verdade.

## Isolamento e autorização

A regra obrigatória é **filtrar por autorização antes da busca vetorial**. Um
resultado proibido não pode ser recuperado e depois ocultado do texto, porque
nesse ponto ele já entrou no contexto do modelo.

- `super_admin`: administra configuração, mas leitura de conteúdo sensível deve
  seguir necessidade real e ser auditada;
- `admin`: não recebe acesso automático a espaços restritos;
- `supervisor`: administra agentes e memória comum do próprio setor, se
  delegado;
- `operator`: usa agentes liberados e vê apenas espaços/notas autorizados;
- service role só aparece dentro de Edge Functions após autorização do caller.

O `knowledge_search` atual busca um corpus global e não serve para este módulo.
Deve existir uma RPC separada que receba os espaços já autorizados e aplique
ACL, classificação, validade e status de revisão dentro da própria query.

## RH, saúde e relações trabalhistas

Reclamações, ocorrências médicas, avaliações, recrutamento e medidas trabalhistas
não devem alimentar um “super cérebro” genérico. São domínios de alto impacto e
podem conter dados pessoais sensíveis.

Separação recomendada:

- **Conhecimento RH geral**: políticas, benefícios, processos e FAQs;
- **Casos RH restritos**: reclamações e apurações, com acesso nominal;
- **Saúde ocupacional**: espaço separado, mínimo de dados, retenção própria e
  sem exposição ao agente geral de RH;
- **Recrutamento**: workspace por processo, prazo de expiração e proibição de
  decisão automatizada baseada em inferências sensíveis;
- **Trabalhista**: o agente organiza fontes e rascunhos, mas a decisão e revisão
  jurídica permanecem humanas.

Controles mínimos: finalidade registrada, minimização, retenção e descarte,
criptografia, auditoria de acesso, exportação controlada, correção, anonimização
quando possível, resposta a incidente e revisão humana. Antes de produção, o
fluxo deve passar por avaliação jurídica/LGPD específica; este documento é uma
proposta técnica, não parecer jurídico.

## Aprimoramento diário sem “treinar escondido”

O agente melhora por curadoria e recuperação, não alterando o modelo com cada
conversa. Pipeline diário sugerido:

1. extrair propostas de memória com referência ao conteúdo original;
2. detectar duplicatas, contradições, dado sensível e prazo de validade;
3. encaminhar a uma fila de revisão do responsável pelo espaço;
4. publicar somente itens aprovados;
5. reindexar embeddings;
6. medir buscas sem resposta, utilidade, correções e conteúdo vencido;
7. sugerir lacunas de documentação ao setor.

Feedback “útil/incorreto/desatualizado” gera tarefa de revisão; não modifica
silenciosamente prompt ou fatos. Prompts e skills permanecem versionados e têm
rollback, seguindo o padrão de observabilidade já usado pelo agente externo.

## Fases de entrega

### Fase 0 — governança

- mapa de dados, finalidade, classificação e responsáveis;
- matriz de acesso por setor e espaço;
- política de retenção e casos proibidos;
- avaliação LGPD/jurídica para RH, recrutamento e saúde.

### Fase 1 — MVP seguro

- um agente interno por setor;
- threads privadas do colaborador com o agente;
- RAG somente em documentos aprovados do setor;
- citações, feedback e auditoria;
- sem memória automática e sem ações externas.

### Fase 2 — memória curada

- notas Markdown, backlinks, grafo e busca híbrida;
- propostas de memória e fila de aprovação;
- versionamento, validade, contradições e retenção;
- espaços de projeto e compartilhamento explícito.

### Fase 3 — skills

- catálogo allowlisted e permissões por agente;
- briefing, brainstorming, checklists, projetos e resumos;
- confirmação humana e trilha de execução;
- avaliações contra prompt injection e vazamento entre setores.

### Fase 4 — domínios sensíveis

- somente depois de auditoria de segurança e governança;
- vaults separados para casos RH/saúde;
- acesso nominal, logs revisados e exportação controlada;
- testes de autorização negativa e exercícios de incidente.

## Critério de sucesso

- nenhuma recuperação cruza setor/espaço sem permissão;
- toda resposta baseada em memória mostra fonte e data;
- memória canônica sempre tem autor/revisor e histórico;
- conteúdos vencidos ou contraditórios não são apresentados como fato;
- dado sensível nunca entra em telemetria ou memória geral;
- usuário consegue corrigir, arquivar e solicitar exclusão conforme política;
- ações de alto impacto exigem confirmação e responsável humano.
