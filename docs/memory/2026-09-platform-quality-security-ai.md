---
title: Qualidade, segurança, agentes internos e memória organizacional
date: 2026-09-01
status: approved
scope:
  - platform-security
  - team-administration
  - product-design
  - internal-ai
  - training
source_type: product-conversation
confidentiality: internal
---

# Contexto consolidado — setembro de 2026

## Objetivo desta memória

Preservar o raciocínio e as decisões desta rodada para:

- orientar próximas implementações;
- impedir que requisitos de segurança se percam entre sessões;
- alimentar futuramente a memória RAG interna com conteúdo revisado;
- servir de matéria-prima para treinamento de administradores, supervisores e
  operadores;
- distinguir claramente o que já existe do que ainda é proposta.

## Estado da plataforma encontrado na vistoria

O MegaCRM é uma instalação single-org com quatro papéis, departamentos,
WhatsApp via Zernio/Evolution, inbox, campanhas, RAG, chat interno, reuniões e
agente externo. A vistoria registrou como riscos prioritários contratos externos
ainda assumidos, ausência de teste real sistemático de RLS, warnings de lint,
auditoria de dependências inconclusiva, proteção desigual de endpoints públicos
e necessidade de governança operacional.

Fonte detalhada: `docs/VISTORIA-2026-09-01.md`.

## Decisões já implementadas

### Administração hierárquica de usuários

- `super_admin` pode suspender/reativar `admin`, `supervisor` e `operator`;
- `admin` pode suspender/reativar `supervisor` e `operator`;
- ninguém altera a própria conta ou um nível igual/superior;
- suspensão preserva histórico e aplica bloqueio no Auth, PostgREST e Edge
  Functions;
- a tela Equipe comunica o status e oferece a ação quando autorizada.

Arquivos centrais:

- `supabase/migrations/20260901220000_user_activation.sql`;
- `supabase/functions/set-team-member-active/index.ts`;
- `supabase/functions/_shared/user-hierarchy.ts`;
- `src/app/routes/settings/sections/TeamSettings.tsx`.

### Convites de uso único

- novo convidado fica pendente e não recebe acesso normal aos dados;
- aceite usa claim atômico com lease recuperável de dez minutos;
- concorrência/reutilização retorna conflito;
- senha é definida por Edge Function, não diretamente pelo browser;
- consumo é registrado e a sessão criada pelo link é revogada;
- o usuário realiza novo login com a senha escolhida.

Arquivos centrais:

- `supabase/migrations/20260901230000_single_use_invites.sql`;
- `supabase/functions/accept-team-invite/index.ts`;
- `supabase/functions/invite-team-member/index.ts`;
- `src/app/routes/invite/InvitePage.tsx`.

### Proteções de implantação

- callback Recall.ai alcança o handler sem JWT da plataforma, mantendo a
  validação do segredo da aplicação;
- Vercel envia headers contra MIME sniffing, framing, referrer excessivo,
  capacidades desnecessárias do navegador e downgrade HTTPS;
- CSP continua planejada para modo report-only antes de enforcement.

## Decisões propostas, ainda não implementadas

### Modernização visual

Direção aprovada para planejamento: **operational calm**. Reduzir glass/glow
permanente, criar superfícies e tokens semânticos, padronizar componentes,
redesenhar a gestão de Equipe e melhorar header, sidebar, navegação e
acessibilidade.

Não apresentar isso como entregue. Roteiro: `docs/DESIGN-MODERNIZATION.md`.

### Agentes internos por setor

É viável criar agentes RH, Comercial, Operações e Projetos. Eles devem ser um
módulo separado do agente externo para que conteúdo interno nunca seja enviado
ao WhatsApp/Instagram. Podem reutilizar adapter LLM, embeddings, chunking e
componentes, mas precisam de threads, tabelas, RPCs, RLS e observabilidade
próprias.

### Skills especialistas

Skills serão capacidades allowlisted e auditadas, como briefing, brainstorming,
checklist, resumo, pesquisa de memória e proposta de nota. Ações disciplinares,
trabalhistas, contratação/desligamento e comunicações oficiais exigem humano
responsável e nunca serão executadas automaticamente.

### Segunda memória estilo Obsidian

O conceito aprovado tem três camadas:

1. sessão temporária;
2. memória episódica com fonte/data/confidencialidade;
3. memória canônica revisada, única tratada como verdade institucional.

O grafo terá notas Markdown, backlinks tipados, chunks, fontes, ACL, revisões,
logs de acesso, validade, retenção e legal hold. Autorização é aplicada antes da
busca vetorial. O corpus global atual de `knowledge_search` não será reutilizado
para informação interna restrita.

Arquitetura completa: `docs/INTERNAL-AI-AGENTS.md`.

## Limites para RH e dados sensíveis

Não salvar reclamações, ocorrências médicas, candidatos ou medidas trabalhistas
na memória canônica geral nem neste diretório. A proposta separa:

- conhecimento geral de RH;
- casos RH restritos com acesso nominal;
- saúde ocupacional em vault independente;
- recrutamento por processo e com expiração;
- trabalhista como suporte de pesquisa/rascunho com revisão humana/jurídica.

Antes desses casos entrarem em produção: avaliação jurídica/LGPD, finalidade,
minimização, criptografia, retenção, descarte, auditoria, exportação controlada e
resposta a incidente.

## Como esta memória vira treinamento

### Público e trilhas

1. **Super admin — implantação e governança**
   - setup, credenciais, departamentos e papéis;
   - suspensão/reativação e auditoria;
   - integrações, backups, restore e incidentes.
2. **Admin — operação administrativa**
   - equipe abaixo da própria hierarquia;
   - configurações, campanhas, conhecimento e métricas;
   - limites de acesso a espaços restritos.
3. **Supervisor — gestão do setor**
   - fila, distribuição, cobertura, SLA e qualidade;
   - agente interno e curadoria do conhecimento setorial.
4. **Operator — trabalho diário**
   - inbox, contatos, notas, handoff, chat interno e segurança;
   - como perguntar ao agente e verificar fontes.

### Formato de cada aula

- objetivo e pré-requisitos;
- cenário real;
- passo a passo com screenshots;
- regra de permissão relevante;
- “o que pode dar errado”;
- exercício prático;
- checklist de conclusão;
- versão do produto/commit usado para gravar a aula.

### Conversas como fonte

Conversas de desenvolvimento e produto podem gerar propostas de memória, mas o
treinamento consome apenas a versão consolidada e aprovada. Antes de publicar:

1. remover segredos e dados pessoais;
2. separar comportamento atual de ideia futura;
3. validar contra código/migrations;
4. indicar papel e pré-condição;
5. incluir fonte e commit;
6. revisar após mudança relevante do produto.

## Perguntas frequentes derivadas deste contexto

### Um admin pode desativar outro admin?

Não. Só níveis estritamente inferiores podem ser administrados. Um
`super_admin` pode administrar um `admin`; um `admin` administra apenas
`supervisor` e `operator`.

### Desativar apaga o histórico?

Não. Suspensão é reversível e preserva os registros relacionados.

### O convite pode ser usado novamente?

Não pelo fluxo da aplicação. O aceite é reclamado atomicamente, marcado como
consumido e a sessão temporária do link é revogada.

### O agente de RH pode acessar tudo?

Não. Ele acessa somente espaços autorizados; casos sensíveis exigem vault e ACL
específicos. Administração técnica não equivale a permissão de leitura.

### O agente aprende automaticamente tudo o que é conversado?

Não. Ele propõe memórias. Um responsável aprova o que passa à camada canônica.

## Próximas ações sugeridas

1. transformar este padrão Markdown em schema de ingestão da segunda memória;
2. criar validador de frontmatter/status e detector básico de segredos no CI;
3. construir a Fase 0 de governança dos agentes internos;
4. produzir primeiro treinamento do fluxo Equipe/convites;
5. adicionar screenshots apenas após aplicar migrations/functions em staging;
6. revisar esta memória sempre que os fluxos citados mudarem.

## Relações

- complementa `docs/VISTORIA-2026-09-01.md`;
- complementa `docs/DESIGN-MODERNIZATION.md`;
- complementa `docs/INTERNAL-AI-AGENTS.md`;
- complementa `docs/memory/2026-09-production-commercialization-roadmap.md`;
- não substitui `CLAUDE.md`, que continua como fonte arquitetural principal.
