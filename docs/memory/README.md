# Memória canônica do produto

Este diretório é a primeira fonte da “segunda memória” organizacional do
MegaCRM. Ele preserva decisões e contexto em Markdown versionado pelo Git para
que possam ser revisados por humanos, usados em onboarding e, futuramente,
indexados pelo módulo de memória descrito em `docs/INTERNAL-AI-AGENTS.md`.

## Regras

1. Um arquivo registra decisões consolidadas, não um dump bruto de conversa.
2. Toda entrada contém data, status, escopo, participantes por papel (nunca
   tokens, senhas ou dados pessoais desnecessários), decisões, razões e fontes.
3. Fatos ainda não implementados ficam marcados como `proposed`; não devem ser
   apresentados em treinamento como funcionalidade disponível.
4. Mudança de decisão cria uma nova revisão no Git e atualiza a seção
   “Substitui/é substituído por”. Não apagar o histórico para parecer coerente.
5. Conteúdo sensível de RH, saúde, recrutamento ou trabalhista não entra aqui.
   Esses domínios exigirão vault, ACL, retenção e auditoria próprios.
6. A memória futura deve indexar somente entradas `approved`, preservando
   arquivo, seção, commit e data como citação.

## Estados

- `draft`: contexto ainda em organização;
- `approved`: decisão canônica e segura para treinamento;
- `superseded`: preservada, mas substituída por decisão posterior;
- `restricted`: metadado público; conteúdo em armazenamento protegido.

## Índice

- [`2026-09-platform-quality-security-ai.md`](2026-09-platform-quality-security-ai.md)
  — vistoria, segurança de usuários/convites, modernização visual, agentes
  internos e plano de treinamento.
- [`2026-09-production-commercialization-roadmap.md`](2026-09-production-commercialization-roadmap.md)
  — intenção de produção/comercialização, gates, empacotamento, operação,
  treinamento e decisões ainda pendentes.
