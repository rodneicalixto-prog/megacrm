# MegaCRM — Documento de Requisitos do Produto (PRD)

> Gerado a partir do código real (`CLAUDE.md`, rotas em `src/app/routes/`,
> schema `whatsapp_hub`) em 28/09/2026, não de uma entrevista do zero — o
> produto já existe e está em produção. Onde a informação não está no
> código nem em `STATUS.md`/`ISSUES.md`, o campo fica marcado
> `[A PREENCHER]` em vez de inventado. Preencha esses campos e este
> documento vira a referência de produto deste repositório.
>
> Não duplica arquitetura (`CLAUDE.md`), estado atual (`STATUS.md`) nem
> design (`DESIGN.md`) — só o que nenhum dos três cobre: por que o produto
> existe, pra quem, e o que cada funcionalidade entrega.

---

## Nome do produto e ideia em uma frase

**MegaCRM** (nome de código do pacote: `whatsapp-hub`, codinome interno de
marca: "Agentise WhatsApp Hub") — plataforma self-hosted de atendimento e
automação de WhatsApp para uma única organização: inbox com IA + humano,
disparos em massa, funil de vendas e agente com RAG sobre a base de
conhecimento da empresa.

**Instância atual:** exclusiva da **Athenas Terceirização** (ver nota de
rebrand pendente em `DESIGN.md` — paleta de cores vai trocar quando a marca
enviar os hex).

## Usuários-alvo

Equipe interna de uma única organização, em 4 papéis hierárquicos
(`whatsapp_hub.tenant_role`):

| Papel | Quem é | Do que precisa |
|---|---|---|
| `super_admin` | Dono da instância (primeiro usuário criado) | Ver tudo, inclusive o departamento restrito ("Administração Geral") |
| `admin` | Gestor operacional | Mesmo alcance do `super_admin`, exceto departamento restrito |
| `supervisor` | Líder de um departamento | Administrar o próprio setor; entra na fila de round-robin de handoff |
| `operator` | Atendente do dia a dia | Inbox, contatos, tags; entra na fila de round-robin |

[A PREENCHER] — quantos usuários ativos tem a instância da Athenas hoje, e
quantos departamentos estão configurados?

## Problema e solução improvisada de hoje

[A PREENCHER] — qual era o processo da Athenas antes do MegaCRM (WhatsApp
Business App manual? planilha? outra ferramenta?). Não está registrado em
nenhum `.md` do repo nem na memória do JARVIS — só quem acompanhou o
onboarding da Athenas sabe.

O que o código resolve, de forma observável: atendimento de WhatsApp
disperso entre pessoas sem fila, sem histórico centralizado e sem triagem
por IA vira uma inbox única com roteamento por departamento/cargo, handoff
IA↔humano, e histórico + notas privadas por conversa.

## Objetivo e medida de sucesso

[A PREENCHER] — não há uma métrica de sucesso de negócio declarada em
nenhum documento (ex.: tempo médio de resposta alvo, taxa de conversão do
funil, redução de custo por atendimento). O Dashboard (`src/app/routes/
dashboard/`) já calcula tempo médio de resposta (IA e humano), custo por
conversa e distribuição de status — esses são os sinais disponíveis pra
ancorar uma meta, mas a meta em si (quanto é "bom") ainda não foi definida.

## Funcionalidades principais

| Funcionalidade | Benefício pro usuário | Prioridade |
|---|---|---|
| Inbox com IA + handoff humano | Atendimento nunca fica sem resposta; operador assume só quando precisa | [A PREENCHER — provavelmente P0, é o core] |
| Templates de mensagem assistidos por IA | Não depende de redigir e submeter manualmente cada template à Meta | [A PREENCHER] |
| Disparos em massa (campanhas via Zernio + módulo separado via Evolution) | Alcança audiência segmentada por tag/CSV sem enviar 1 a 1 | [A PREENCHER] |
| Follow-up automático em cadeia | Recupera contato que não respondeu, sem esforço manual | [A PREENCHER] |
| Agente de IA com RAG (base de conhecimento) | Respostas automáticas ancoradas em documentos reais da empresa, não alucinadas | [A PREENCHER] |
| Roteamento por departamento/cargo/linha pessoal | Mensagem cai na fila certa (setor) ou na pessoa certa (linha pessoal) automaticamente | [A PREENCHER] |
| Funil/Pipeline (deals) | Acompanha oportunidade de venda além da conversa | [A PREENCHER] |
| Agenda + Reuniões (Google Meet + gravação/resumo opcional) | Agenda reunião sem sair do CRM; resumo automático se Recall.ai estiver configurado | [A PREENCHER] |
| Chat interno (DM 1:1 entre membros) | Equipe se comunica sem sair do CRM | [A PREENCHER] |
| Dashboard analítico | Visibilidade de volume, custo, tempo de resposta, saúde do número | [A PREENCHER] |

**Prioridade não está declarada em nenhum lugar do repo** — a tabela lista
as features existentes; a coluna de prioridade fica em aberto até você
decidir. Se quiser, eu proponho uma ordem com base em "o que quebra o
atendimento se sair do ar" (Inbox > roteamento > disparos > o resto), mas
isso é uma sugestão minha, não um fato do código.

## Fora da versão 1 (ou saindo do produto)

- **`vendas/` (Vendas & Recompra)** — a rota existe em
  `src/app/routes/vendas/` mas o comentário no próprio `router.tsx`/
  `CLAUDE.md` diz "saindo do projeto (ver `PLANEJAMENTO.md`)".
  [A PREENCHER] — confirmar se já pode ser removida do código ou se ainda
  está em uso transitório.
- Internacionalização (i18n) — interface é PT-BR fixo, sem plano declarado
  de outro idioma.

## Histórias de usuário (amostra a partir do código)

- Como **operador**, eu quero que a IA responda automaticamente dentro da
  janela de 24h usando a base de conhecimento, para que o contato não
  espere um humano pra dúvidas simples.
- Como **operador**, eu quero pausar a IA numa conversa específica, para
  assumir o atendimento quando o caso exigir uma pessoa.
- Como **supervisor**, eu quero que mensagens do meu departamento entrem
  numa fila round-robin entre os operadores online, para distribuir a carga
  sem favorecer ninguém.
- Como **admin**, eu quero disparar uma campanha segmentada por tag com
  variáveis mapeadas por contato, para personalizar em massa sem enviar
  1 a 1.
- Como **admin**, eu quero configurar regras de follow-up em cadeia, para
  recuperar contatos que não responderam sem precisar lembrar manualmente.
- [A PREENCHER] — histórias específicas do funil/pipeline e da agenda ainda
  não foram escritas; o código mostra a mecânica (deals, arquivar/
  restaurar; calendários), não o "porquê" do usuário.

## Critérios de aceite (amostra)

- Dado um contato sem departamento ativo com IA habilitada nesse canal,
  quando chega uma mensagem inbound, então a conversa vai para atendimento
  humano em vez de travar sem resposta.
- Dado um operador que clica "Pausar IA", quando a IA está ativa numa
  conversa, então `conversation.ai_paused` vira `true` e todos os
  operadores do departamento recebem notificação de handoff.
- Dado um disparo em massa em andamento, quando o limite de throttle
  (`min_delay_seconds`/`max_delay_seconds`) não foi atingido, então a
  próxima mensagem da fila é enviada; caso contrário, aguarda o próximo
  tick.
- [A PREENCHER] — critérios de aceite completos por funcionalidade exigiriam
  passar por cada rota com you (dono do produto) validando o que é
  "sucesso" vs "bug" — o código descreve o comportamento atual, não
  necessariamente o comportamento desejado.

## Perguntas em aberto

1. Meta de sucesso do produto (seção "Objetivo e medida de sucesso") — qual
   número prova que o MegaCRM está funcionando pra Athenas?
2. Prioridade real das funcionalidades da tabela acima.
3. `vendas/` sai do código ou fica mais um tempo?
4. Existe roadmap além do Épico 3 (debt) registrado em `STATUS.md`? Ou o
   produto está em modo manutenção agora?
5. Quantos usuários/departamentos a instância da Athenas tem hoje, pra
   dimensionar o que "funciona bem" significa em escala real (10 operadores
   é diferente de 100).
