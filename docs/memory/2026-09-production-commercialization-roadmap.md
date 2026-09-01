---
title: Produção e futura comercialização da plataforma
date: 2026-09-01
status: approved
scope:
  - production-readiness
  - commercialization
  - product-packaging
  - operations
source_type: product-decision
confidentiality: internal
---

# Produção e futura comercialização

## Decisão estratégica

O MegaCRM será colocado em produção e, futuramente, transformado em um produto
comercializável. Esta intenção é canônica; funcionalidades, preços, SLAs e
modelo de distribuição continuam propostas até aprovação específica.

O produto atual é **single-org por instalação**. Comercializar não significa
transformá-lo silenciosamente em SaaS multi-tenant. Existem duas opções que
devem ser decididas antes do produto comercial:

1. **Instância isolada por cliente** — mantém a arquitetura atual, melhora
   isolamento e simplifica LGPD, mas aumenta custo operacional e automação;
2. **SaaS multi-tenant** — exige redesign explícito de schema, RLS, billing,
   rate limits, observabilidade e migração. Não reaproveitar vestígios do modelo
   multi-tenant antigo como se estivessem prontos.

Até decisão posterior, o caminho oficial é instância isolada por organização.

## Gate de produção

Nenhuma versão deve receber tráfego real apenas porque compila. O primeiro
release produtivo exige evidência dos itens abaixo.

### Segurança e identidade

- migrations aplicadas e inventário de Edge Functions conferido;
- matriz negativa/positiva de RLS para os quatro papéis e departamentos;
- convites one-shot e suspensão testados contra Auth real;
- secrets fora de logs e frontend, com rotação documentada;
- MFA avaliado para `super_admin` e `admin`;
- rate limit e limite de payload nos endpoints públicos;
- dependências auditadas sem achado crítico não aceito;
- headers defensivos ativos e CSP validada primeiro em report-only.

### Dados e recuperação

- backup automatizado;
- restore completo ensaiado e cronometrado;
- RPO/RTO definidos;
- retenção e descarte por classe de dado;
- exportação e correção de dados testadas;
- plano para indisponibilidade de Supabase, Vercel, WhatsApp e LLM.

### Integrações

- contratos Zernio, Evolution, Recall, Google e provedores LLM validados em
  contas reais de staging;
- idempotência, retry com backoff e timeout;
- webhook duplicado, atrasado, fora de ordem e com assinatura inválida;
- degradação segura quando IA, embedding ou provedor externo falhar;
- reconciliação de filas/campanhas após interrupção.

### Qualidade e operação

- E2E dos fluxos críticos;
- lint com orçamento regressivo e sem novos warnings;
- alertas de fila parada, cron, webhook, taxa de erro, latência e custo de IA;
- dashboards e logs estruturados sem dados sensíveis;
- runbooks, rollback e responsável por incidente;
- release candidate em staging e smoke test pós-deploy.

## Baseline comercial

### Proposta de valor

Uma plataforma operacional de relacionamento e automação WhatsApp, com inbox,
hierarquia/departamentos, campanhas, CRM, RAG, reuniões e agentes de IA, que
pode evoluir para memória organizacional e assistentes internos por setor.

O diferencial comercial não deve ser “tem IA”. Deve ser:

- contexto operacional conectado;
- governança por setor e papel;
- rastreabilidade das respostas e decisões;
- automação com handoff humano;
- implantação e treinamento reproduzíveis;
- isolamento e segurança verificáveis.

### Pacotes a validar

Não são preços aprovados; são hipóteses para discovery:

- **Core:** inbox, contatos, departamentos e chat interno;
- **Growth:** campanhas, funil, agenda, métricas e automações;
- **AI:** agente externo, RAG, observabilidade e perfis;
- **Knowledge:** agentes internos, memória curada e skills;
- **Enterprise:** SSO/MFA avançado, auditoria, retenção, vaults e SLA.

O módulo comercial já existente não deve ser tratado como billing definitivo.
Entitlements precisam ser enforced no backend e auditáveis, não apenas esconder
itens de menu.

## Produto instalável e atualizável

Para vender com segurança, cada instalação precisa ser reproduzível:

- versão semântica e changelog;
- migrations idempotentes e backup anterior ao upgrade;
- compatibilidade documentada entre frontend, banco e Edge Functions;
- health check que valide versão e dependências;
- rollback ou roll-forward testado;
- ambientes dev/staging/prod separados;
- checklist de instalação sem credencial em documentação/screenshot;
- telemetria opt-in e sem conteúdo de mensagens por padrão.

Cada release deve registrar:

- commit e versão;
- migrations incluídas;
- Edge Functions incluídas;
- mudanças de env/credenciais;
- riscos e breaking changes;
- evidências de teste;
- procedimento de atualização e reversão.

## Onboarding e treinamento comercial

O treinamento será gerado a partir de `docs/memory/`, `CLAUDE.md`, código e
screenshots da versão publicada — nunca apenas de conversas brutas.

Materiais mínimos:

1. instalação e primeira configuração;
2. administração de usuários, papéis e departamentos;
3. conexão WhatsApp e diagnóstico;
4. operação do inbox e handoff;
5. contatos, campanhas e funil;
6. conhecimento e agente externo;
7. segurança, privacidade e resposta a incidente;
8. agentes internos/memória quando efetivamente entregues.

Cada cliente deve receber trilha por papel, ambiente de prática e checklist de
go-live. O conteúdo deve indicar versão/commit para não ensinar telas antigas.

## Suporte e sucesso do cliente

Antes da venda devem existir:

- severidades e canais de suporte;
- horário e expectativa de resposta;
- coleta de diagnóstico com consentimento;
- política para acesso temporário à instância do cliente;
- base de conhecimento pesquisável;
- runbooks para incidentes comuns;
- processo de feature request sem prometer roadmap não aprovado;
- métricas de ativação, adoção e valor sem coletar conteúdo sensível.

## Jurídico, privacidade e fornecedores

Antes da comercialização:

- revisar licença open source e dependências;
- termos de uso, privacidade e contrato de tratamento de dados;
- papéis de controlador/operador por modelo de implantação;
- subprocessadores e regiões de dados documentados;
- política de retenção, exclusão, exportação e incidente;
- consentimentos/bases legais avaliados para cada finalidade;
- revisão especial para RH, saúde, recrutamento e dados trabalhistas;
- proibição contratual/técnica de usar dados do cliente para treinamento sem
  autorização explícita e mecanismo de opt-in.

Este registro é planejamento técnico/produtivo, não parecer jurídico.

## Métricas de prontidão

### Produção

- disponibilidade e taxa de erro;
- tempo de fila e campanha parada;
- sucesso/rejeição de webhooks;
- latência p95 de fluxos críticos;
- restauração dentro do RTO;
- incidentes e tempo de recuperação;
- custo por organização e por conversa/uso de IA.

### Comercialização

- tempo até primeiro valor;
- conclusão do onboarding por papel;
- adoção semanal dos módulos;
- taxa de handoff e resolução;
- retenção e expansão;
- chamados por cliente/módulo;
- margem após Supabase, Vercel, WhatsApp, storage e LLM;
- satisfação e correções da base de treinamento.

Métricas não autorizam coletar conteúdo de conversa. Preferir eventos agregados
e pseudonimizados.

## Decisões pendentes

1. instância isolada gerenciada, self-hosted suportado ou futuro SaaS;
2. segmentos e problema principal do cliente ideal;
3. pacote mínimo e módulos adicionais;
4. SLA e canais de suporte;
5. política de atualização das instalações;
6. provedores/regiões aceitos;
7. escopo e governança dos agentes internos;
8. precificação e limites de consumo;
9. requisitos enterprise (SSO, MFA, auditoria, retenção);
10. processo formal de release e aprovação de produção.

## Próxima revisão

Revisar antes do primeiro go-live e novamente antes de qualquer oferta
comercial. Ao decidir um item, registrar nova memória aprovada e vincular esta
entrada como fonte ou como decisão substituída.

## Relações

- complementa `docs/memory/2026-09-platform-quality-security-ai.md`;
- usa os gates de `docs/VISTORIA-2026-09-01.md`;
- usa a direção de `docs/DESIGN-MODERNIZATION.md`;
- agentes/memória detalhados em `docs/INTERNAL-AI-AGENTS.md`;
- `CLAUDE.md` permanece a fonte da arquitetura implementada.
