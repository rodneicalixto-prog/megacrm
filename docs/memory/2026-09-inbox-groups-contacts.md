---
title: Grupos da Inbox, contatos fixados, agenda Evolution e encaminhamento
date: 2026-09-02
status: approved
scope:
  - inbox
  - contacts
  - evolution
  - hierarchy
  - training
source_type: product-decision
confidentiality: internal
---

# Organização de atendimentos e contatos

## Objetivo desta memória

Registrar o comportamento entregue em setembro de 2026 para que produto,
suporte e treinamento descrevam a mesma funcionalidade. Esta entrada é a
matéria-prima canônica do futuro manual de uso, enquanto `CLAUDE.md` continua
sendo a fonte técnica da arquitetura.

## Estado

As funcionalidades descritas aqui estão implementadas pela migration
`20260902120000_private_attendance_groups.sql` e pelo frontend da Inbox e de
Contatos. A sincronização automática depende de uma instância Evolution que
emita o evento `CONTACTS_UPSERT` e esteja com o webhook atualizado.

## Decisões consolidadas

### Grupos privados de atendimento

Cada usuário pode criar grupos na barra lateral da Inbox e usar esses grupos
para filtrar conversas. Um atendimento pode ser colocado em um grupo por vez
pela interface atual. Excluir um grupo remove somente a organização pessoal;
conversas, mensagens, responsáveis e departamentos permanecem intactos.

Os grupos pertencem ao usuário que os criou. Outro operador não vê seus nomes,
suas contagens nem a associação das conversas, mesmo quando ambos podem acessar
o mesmo atendimento por causa do departamento. O grupo organiza a visualização
e não transfere o atendimento, não muda a fila e não substitui tags.

### Cinco contatos fixados

A estrela de uma conversa cria um favorito pessoal. Os favoritos aparecem no
início da lista para acesso rápido, respeitando os demais filtros ativos. Cada
usuário pode manter no máximo cinco conversas fixadas.

O limite existe no frontend para retorno imediato e no banco para cobrir duas
abas ou requisições simultâneas. Ao atingir cinco, o usuário precisa remover um
favorito antes de fixar outro. Favoritos não são compartilhados com a equipe.

### Sincronização da agenda do celular

Ao parear uma linha Evolution, o webhook passa a assinar `CONTACTS_UPSERT`, além
de `MESSAGES_UPSERT`. Quando a Evolution envia a agenda sincronizada, a
plataforma salva apenas contatos individuais identificados por
`@s.whatsapp.net`.

Grupos do WhatsApp, listas de transmissão e status não entram em Contatos. O
telefone normalizado é a chave de deduplicação. Se o contato já existe e tem
nome, a sincronização preserva o nome editado na plataforma; se existe sem nome,
o nome recebido pode completar o cadastro. Novos registros recebem origem
`whatsapp`.

Essa automação é orientada por evento, portanto o simples estado “conectado” não
prova que toda versão ou fork da Evolution enviou a agenda. O suporte deve
confirmar o registro do webhook e a emissão de `CONTACTS_UPSERT` antes de tratar
ausência de contatos como erro da tela.

### Encaminhamento de contato

A lista de contatos não é compartilhada entre operadores. Na aba Contatos, o
usuário seleciona um ou mais registros e escolhe “Encaminhar para…”. O
destinatário ganha acesso somente aos contatos encaminhados.

O encaminhamento respeita a hierarquia. Ninguém encaminha para um papel acima
do próprio. Supervisores e operadores só encaminham dentro do próprio
departamento. Administradores e superadministradores mantêm seu alcance amplo,
sem tornar a lista pessoal do remetente visível ao destinatário.

Encaminhar um contato não transfere automaticamente conversas, negócios ou a
responsabilidade do atendimento. Quando a intenção for mudar o responsável por
uma conversa, o usuário deve usar a ação de transferência da Inbox.

## Diferenças que o manual precisa ensinar

| Recurso | Finalidade | Compartilhado | Efeito operacional |
|---|---|---|---|
| Grupo da Inbox | Organizar conversas na visão pessoal | Não | Apenas filtra e ordena a visão |
| Favorito | Manter até cinco conversas no topo | Não | Acesso rápido, sem mudar responsável |
| Tag | Classificar contatos para filtros e campanhas | Conforme RLS do contato | Pode alimentar segmentações |
| Encaminhar contato | Dar acesso pontual a outra pessoa | Somente o contato escolhido | Não transfere a conversa |
| Transferir conversa | Mudar setor ou responsável do atendimento | Visível conforme a nova atribuição | Altera a operação da Inbox |

## Roteiro-base do futuro manual

### Para operadores

1. Criar um grupo pelo ícone ao lado de “Grupos” na Inbox.
2. Abrir uma conversa e escolher o grupo no seletor “Mover atendimento para
   grupo”.
3. Clicar no grupo para ver somente seus atendimentos organizados ali.
4. Usar a estrela para fixar contatos prioritários, até o limite de cinco.
5. Na aba Contatos, selecionar registros e usar “Encaminhar para…” quando outra
   pessoa precisar somente do cadastro.
6. Usar “Transferir” na Inbox quando outra pessoa ou setor assumir o
   atendimento.

### Para administradores

1. Confirmar que a instância Evolution está conectada e com webhook registrado.
2. Confirmar que `CONTACTS_UPSERT` está entre os eventos do webhook.
3. Validar um pareamento com um contato de teste antes de orientar importações
   manuais.
4. Explicar que grupos e favoritos são pessoais e não servem como fila
   compartilhada.
5. Validar papel e departamento quando um encaminhamento for recusado pela
   hierarquia.

## Critérios de aceite para treinamento

O material de treinamento só deve afirmar que a agenda sincroniza
automaticamente depois de um teste real com a versão Evolution usada pela
instalação. Capturas de tela devem mostrar dados fictícios. O exemplo de
encaminhamento precisa distinguir acesso ao cadastro de transferência do
atendimento. O exemplo de grupos precisa deixar explícito que a organização é
privada.

## Limites e perguntas frequentes

### Um grupo é uma fila compartilhada?

Não. É uma lista pessoal para organizar a Inbox. Filas, atribuições e
departamentos continuam sendo os mecanismos operacionais compartilhados.

### Posso colocar o mesmo atendimento em vários grupos?

O banco aceita associações múltiplas, mas a interface atual trabalha com um
grupo por atendimento. O manual deve ensinar o comportamento disponível na
interface.

### O destinatário recebe todo o histórico do contato?

O encaminhamento concede leitura do cadastro. O histórico de conversas e
negócios continua submetido às políticas próprias de departamento e atribuição.

### Por que a agenda não apareceu depois do QR Code?

As causas a verificar são: webhook antigo sem `CONTACTS_UPSERT`, versão ou fork
da Evolution que não emite a carga de contatos, pareamento ainda incompleto ou
payload incompatível. Não orientar o usuário a reconectar repetidamente antes
de verificar esses pontos.

## Fontes no repositório

- `supabase/migrations/20260902120000_private_attendance_groups.sql`;
- `src/hooks/useAttendanceGroups.ts`;
- `src/components/inbox/AttendanceGroups.tsx`;
- `src/app/routes/inbox/InboxPage.tsx`;
- `src/app/routes/contacts/ContactsPage.tsx`;
- `supabase/functions/whatsapp-inbound/index.ts`;
- `api/evolution-instance.ts` e `api/evolution-status.ts`.

## Relações

- Complementa `docs/memory/2026-09-platform-quality-security-ai.md`.
- Complementa `docs/PLANO-HIERARQUIA.md` sem substituir as regras de papéis e
  departamentos.
- Não substitui `CLAUDE.md`, que permanece como fonte técnica principal.

## Substitui/é substituído por

Não substitui outra decisão. Uma mudança futura no caráter privado dos grupos,
no limite de favoritos ou na hierarquia de encaminhamento deve criar nova
entrada e marcar esta como `superseded`.
