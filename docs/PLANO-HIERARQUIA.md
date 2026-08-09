# Plano — Hierarquia de perfis e departamentos

> Escrito em 2026-08-08 sobre `62c0ba6`. Este documento é **plano**, não
> implementação. Nada aqui está no código ainda.

---

## 1. O que muda, em uma frase

Hoje o CRM tem **2 papéis e nenhum departamento**, e **todo usuário autenticado
lê tudo**. O pedido é **4 papéis, departamentos, e visibilidade recortada por
departamento** — o que significa reescrever o modelo de leitura, não só
acrescentar dois valores num enum.

---

## 2. Ponto de partida

### O que existe

| Item | Situação hoje |
|---|---|
| Papéis | `admin` \| `operator` (enum `tenant_role`) |
| Origem do papel | 1º usuário = admin; demais só por convite |
| Onde o papel vive | `app_users.role`, espelhado em `auth.users.raw_app_meta_data.role` |
| Como a RLS lê | `current_user_role()` → lê o JWT, sem consultar tabela |
| Departamentos | **não existem** |
| Fila | `lead_assignment_queue` — global, round-robin puro, sem departamento |
| Transferência | só `conversations.assigned_to` (troca de responsável), sem histórico |
| Métricas | globais |

### A pedra no caminho

```sql
CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY messages_select ON whatsapp_hub.messages
  FOR SELECT TO authenticated USING (true);
```

**`USING (true)`** — leitura aberta a qualquer autenticado, em todas as tabelas
de domínio. A regra "supervisor não visualiza os demais departamentos" cai
inteira aqui. Esse é o coração do trabalho; os papéis novos são a parte fácil.

---

## 3. Papéis pedidos

| Papel | Escopo |
|---|---|
| **super_admin** | tudo, inclusive enxergar e gerenciar admins. **Tem caixa própria, sigilosa** |
| **admin** | tudo, **exceto** o super_admin: nem a pessoa, nem as conversas dele |
| **supervisor** | apenas o próprio departamento |
| **user** (atendente) | apenas o que está atribuído a ele + a fila do seu departamento |

> `super_admin` **existiu** neste código e foi removido na migration
> `20260430120001_drop_super_admin`, quando o produto virou self-hosted de uma
> organização só. Está voltando com outro sentido: antes era o operador da
> plataforma acima dos clientes; agora é o topo da hierarquia interna da empresa.

### Matriz de permissão

Legenda: ✅ pode · ⬜ não pode · 🔶 restrito ao próprio departamento

| Capacidade | super_admin | admin | supervisor | user |
|---|:--:|:--:|:--:|:--:|
| Configurar a empresa | ✅ | ✅ | ⬜ | ⬜ |
| Criar/editar departamentos | ✅ | ✅ | ⬜ | ⬜ |
| Cadastrar supervisor | ✅ | ✅ | ⬜ | ⬜ |
| Cadastrar atendente | ✅ | ✅ | 🔶 | ⬜ |
| Conectar WhatsApp | ✅ | ✅ | ⬜ | ⬜ |
| Ver todos os atendimentos | ✅ | ✅ | 🔶 | ⬜ |
| Ver a fila | ✅ | ✅ | 🔶 | 🔶 |
| Transferir atendimento | ✅ | ✅ | ✅ | ✅ |
| Ver métricas | ✅ | ✅ | 🔶 | ⬜ |
| **Enxergar o usuário super_admin** | ✅ | **⬜** | ⬜ | ⬜ |
| **Ler conversas da Administração Geral** | ✅ | **⬜** | ⬜ | ⬜ |
| Responder / status / observação / finalizar | ✅ | ✅ | ✅ | ✅ |

---

## 3.2. Administração Geral — o departamento sigiloso

**Definido:** o super_admin é o dono da empresa e tem **caixa própria**. As
conversas dele ficam no departamento **Administração Geral**, e **nem o admin
enxerga** — não é só a pessoa que some da lista, é o conteúdo.

Isso inverte uma premissa da seção 5: `admin` **deixa de ver tudo**.

```sql
-- Departamento com leitura restrita aos proprios membros. Admin nao entra.
ALTER TABLE whatsapp_hub.departments
  ADD COLUMN is_restricted BOOLEAN NOT NULL DEFAULT false;
```

```sql
CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated USING (
    -- super_admin: sem recorte.
    whatsapp_hub.current_user_role() = 'super_admin'
    -- admin: tudo, MENOS departamento restrito.
    OR (whatsapp_hub.current_user_role() = 'admin'
        AND NOT whatsapp_hub.department_is_restricted(department_id))
    -- supervisor e atendente: o proprio departamento.
    OR department_id = whatsapp_hub.current_user_department()
  );
```

> `is_restricted` como flag, e não `name = 'Administração Geral'` fixo no
> código: o dia em que existir um segundo setor sigiloso — jurídico, RH — a
> regra já vale, sem migration nova.

### 🔴 O furo que isso abre

Com **um número só**, a conversa chega **sem departamento** e cai na fila de
triagem — que é justamente onde o admin está olhando.

```
cliente/contato pessoal manda mensagem
        ↓
conversa criada, department_id = NULL
        ↓
FILA GERAL  ← o admin lê aqui
        ↓
alguém tria para Administração Geral
        ↓
agora está sigilosa — tarde demais
```

**O sigilo chega depois da exposição.** Sem tratar isso, a promessa não se
cumpre: toda conversa do dono passa pelos olhos do admin antes de virar
sigilosa.

### Como fechar

O roteamento tem que acontecer **na entrada**, antes de qualquer fila:

```sql
contact_routing_rules
├── id
├── phone            TEXT      -- E.164 do contato
├── department_id    UUID      -- destino
└── created_by       UUID
```

No `whatsapp-inbound`, ao criar/resolver o contato: **se o telefone estiver na
lista, a conversa já nasce com `department_id` preenchido** e nunca aparece na
fila geral.

Quem administra essa lista: **só o super_admin**, e ela é invisível para o
admin — senão ele descobre pela lista quem são os contatos sigilosos, mesmo sem
ler as conversas.

### Alternativas, se a lista não servir

| Opção | Como | Custo do sigilo |
|---|---|---|
| **Lista de contatos** (recomendado) | telefone conhecido → nasce sigiloso | precisa cadastrar antes; contato novo vaza uma vez |
| **Palavra-chave** | contato manda um código, ex. `#adm` | vaza a primeira mensagem |
| **Triagem só pelo super_admin** | ninguém mais vê a fila geral | trava o atendimento normal — inviável |
| **Número separado** | o dono usa outra linha | resolve por completo, mas contraria "todos no mesmo número" |

**Nenhuma cobre o primeiro contato desconhecido.** Sigilo total com número
compartilhado é impossível — é uma propriedade do canal, não do software. Vale
decidir com isso claro.

---

## 3.1. Um número, vários departamentos

**Restrição definida:** existe **um único número principal de WhatsApp**, e
todos os departamentos atendem por ele.

Isso tem uma consequência que decide boa parte do desenho: **a conversa não
nasce sabendo o departamento dela**. Numa operação com um número por setor, o
canal já responde a pergunta. Aqui não — chega tudo pela mesma porta.

Então existe um estado novo, que hoje não existe: **conversa sem departamento**,
aguardando triagem.

```
mensagem nova → conversa criada (department_id = NULL)
                       ↓
                  FILA GERAL  ← quem vê: super_admin e admin
                       ↓
                   triagem
                       ↓
       department_id preenchido → fila do departamento
                       ↓
                  atendente assume
```

### Como triar — quatro caminhos

| Caminho | Como funciona | Esforço |
|---|---|---|
| **Manual** | a conversa cai na fila geral; admin/supervisor escolhe o departamento | baixo — só a ação de transferir, que já está na Fase C |
| **Menu numérico** | bot responde "1 Vendas, 2 Suporte…" e roteia pela resposta | médio — máquina de estados curta antes do atendimento |
| **Pela IA** | o agente já existente lê a intenção e escolhe o departamento | médio — reaproveita `process-ai-message` e o `auto_move_leads`, que já move lead de estágio por critério |
| **Por origem** | UTM/campanha/anúncio de entrada define o departamento | baixo, mas só cobre quem vem de link rastreado |

**Recomendação: começar pelo manual.** Ele é pré-requisito dos outros três — se
a triagem automática errar, alguém precisa corrigir, e essa correção *é* a
transferência manual. Os automáticos entram depois, como atalho sobre uma base
que já funciona.

> Isso conversa com a decisão de deixar o agente de IA desligado agora
> (`20260808140000`): a triagem por IA só faz sentido quando vocês religarem o
> agente.

### O que isso acrescenta ao modelo

- `conversations.department_id` **NULL** é um estado legítimo, não um defeito.
  As policies precisam tratá-lo explicitamente, senão a conversa nova fica
  invisível para todo mundo e o atendimento morre na porta.
- Precisa de um `departments.is_default` (ou config em `app_settings`) para quem
  preferir que tudo caia num departamento em vez de numa fila de triagem.
- A fila geral é uma visão do inbox, não uma tabela nova:
  `WHERE department_id IS NULL`.

---

## 4. Modelo de dados

### Tabelas novas

```sql
departments
├── id             UUID PK
├── name           TEXT UNIQUE
├── description    TEXT
├── is_active      BOOLEAN DEFAULT true
├── is_default     BOOLEAN DEFAULT false  -- destino de quem nao for triado
├── is_restricted  BOOLEAN DEFAULT false  -- admin NAO le (ver 3.2)
└── created_at

contact_routing_rules      -- roteia na ENTRADA, antes da fila (ver 3.2)
├── phone          TEXT UNIQUE
├── department_id  UUID
└── created_by     UUID

conversation_transfers          -- histórico; hoje não existe registro nenhum
├── id                UUID PK
├── conversation_id   UUID
├── from_department_id / to_department_id
├── from_user_id      / to_user_id
├── moved_by          UUID   (quem transferiu)
├── reason            TEXT
└── created_at
```

### Colunas novas

```sql
app_users.department_id      UUID NULL   -- supervisor e atendente pertencem a UM departamento
conversations.department_id  UUID NULL   -- NULL = aguardando triagem (ver 3.1)
lead_assignment_queue.department_id      -- a fila deixa de ser global
departments.is_default       BOOLEAN     -- destino de quem não for triado
```

> Não há coluna de número/instância em lugar nenhum: **o número é um só**. Se um
> dia houver um número por departamento, aí sim `departments` ganha a credencial
> do provedor — e a triagem deixa de ser necessária.

### O enum

```sql
ALTER TYPE whatsapp_hub.tenant_role ADD VALUE 'super_admin';
ALTER TYPE whatsapp_hub.tenant_role ADD VALUE 'supervisor';
```

⚠️ **`ALTER TYPE ... ADD VALUE` não roda dentro de bloco transacional** e o novo
valor não pode ser usado na mesma transação que o criou. Precisa de migration
própria, separada da que passa a usá-lo. Erro clássico nesse ponto.

> `operator` continua existindo e vira sinônimo de `user`. Renomear valor de
> enum em uso quebraria os JWTs já emitidos — quem estiver logado carrega
> `role: 'operator'` no `app_metadata` até renovar a sessão.

---

## 5. O trabalho de verdade: recortar a leitura

### O problema

`current_user_role()` lê o JWT — barato, roda por linha sem custo. Para filtrar
por departamento a policy precisa saber **o departamento do usuário**, e isso
mora em `app_users`. Consultar tabela dentro de policy, por linha, em `messages`,
é o caminho mais curto para um inbox lento.

### Três saídas

| Opção | Como | Custo |
|---|---|---|
| **A — espelhar no JWT** | `handle_new_user` e a troca de departamento gravam `department_id` no `raw_app_meta_data`, igual já é feito com `role` | Mais rápido. Mudança de departamento só vale na próxima sessão |
| **B — função `STABLE`** | `current_user_department()` com `SELECT ... FROM app_users WHERE user_id = auth.uid()` | Postgres avalia uma vez por query, não por linha. Simples, correto, e sem defasagem |
| **C — coluna desnormalizada** | `conversations.department_id` já resolve o filtro sem consultar `app_users` | Não elimina a necessidade de saber o departamento de *quem pergunta* |

**Recomendação: B**, com A como otimização se a medição pedir. `STABLE` já
garante uma avaliação por query, e a defasagem de sessão da opção A é uma
armadilha de suporte ("mudei de departamento e não mudou nada").

### As policies

```sql
-- Quem enxerga tudo.
CREATE FUNCTION whatsapp_hub.sees_all_departments() RETURNS BOOLEAN
  STABLE LANGUAGE sql AS $$
    SELECT whatsapp_hub.current_user_role() IN ('super_admin', 'admin');
  $$;

CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated USING (
    whatsapp_hub.sees_all_departments()
    OR department_id = whatsapp_hub.current_user_department()
    -- Sem isto, a conversa recém-chegada (ainda sem departamento) some para
    -- todo mundo e o atendimento morre na porta.
    OR department_id IS NULL
  );
```

Para o **atendente**, `department_id IS NULL` **não** deve aparecer — ele vê a
fila do seu departamento e o que é dele. A fila de triagem é de quem tria.

`messages` não tem `department_id` — o filtro vai por `EXISTS` na conversa.
Índice em `conversations(department_id)` é obrigatório, não opcional.

### O caso "admin não visualiza superadmin"

Isso **não** é filtro de conversa, é filtro de **pessoa**:

```sql
CREATE POLICY app_users_select ON whatsapp_hub.app_users
  FOR SELECT TO authenticated USING (
    whatsapp_hub.current_user_role() = 'super_admin'
    OR role <> 'super_admin'
  );
```

E precisa valer em três lugares além da tabela: a lista da equipe, o seletor de
responsável e o destino de transferência.

---

## 6. Fases

### Fase A — Fundação · ~2 dias

1. Enum em migration própria (`super_admin`, `supervisor`).
2. `departments` (com `is_default` e `is_restricted`),
   `app_users.department_id`, `conversations.department_id`.
   Semear **Administração Geral** com `is_restricted = true`, e promover o
   usuário owner atual a `super_admin` nele.
3. `current_user_department()` e `sees_all_departments()`.
4. `handle_new_user` aceitando `invited_department` junto de `invited_role`.
5. Backfill: todo mundo hoje é `admin` ou `operator`; criar um departamento
   "Geral" e apontar todos para ele, senão a primeira policy nova esconde tudo.

> **Sem o backfill, o inbox fica vazio no dia do deploy.** Departamento nulo não
> casa com nenhum filtro.

### Fase B — Leitura recortada · ~2–3 dias 🔴 a parte crítica

6. Reescrever as policies de `SELECT` de `conversations`, `messages`,
   `contacts`, e das tabelas do funil.
7. Policy de `app_users` escondendo `super_admin` de `admin`.
7b. **Departamento restrito fora do alcance do admin** — em `conversations`,
    `messages`, `contacts` e no funil. É a regra mais fácil de esquecer numa
    tabela, e a que tem a pior consequência.
8. Índices de departamento.
9. **Testes de policy com usuário de cada papel.** Segurança que não é testada
   é segurança que não existe — e aqui o modo de falha é vazar conversa de um
   departamento para outro.

### Fase C — Triagem, fila e transferência · ~3–4 dias

10. `lead_assignment_queue` por departamento; round-robin dentro do departamento.
11. `conversation_transfers` + a ação de transferir (departamento e/ou pessoa).
    **É também a ferramenta de triagem** — atribuir departamento a uma conversa
    nova é a mesma operação de mover entre departamentos.
12. Transferência não oferece super_admin como destino.
13. Fila do departamento = sem `assigned_to`, naquele departamento.
    Fila geral = `department_id IS NULL`.
14. `departments.is_default` para quem preferir pular a triagem.
15. `contact_routing_rules` + roteamento no `whatsapp-inbound`, para a conversa
    sigilosa **nascer** no departamento certo em vez de passar pela fila geral.

### Fase D — Interface · ~3–4 dias

14. CRUD de departamentos (admin+).
15. Convite com papel **e** departamento.
16. Inbox: filtro por departamento; supervisor vê o seu, admin vê todos.
17. Botão de transferir com seletor de departamento/atendente.
18. Sidebar por papel — atendente não vê Campanhas, Configurações, Agente de IA.

> Esconder no menu **não é permissão**. Continua sendo RLS; o menu só evita
> oferecer o que vai dar erro.

### Fase E — Métricas por departamento · ~2 dias

19. `useDashboardMetrics` e `useSalesDashboard` filtrados por departamento.
20. Supervisor vê só o seu; admin escolhe.

**Total: 11–14 dias.** As fases A e B precisam sair juntas — meio caminho deixa
o sistema num estado pior que o de hoje.

---

## 7. Decisões que preciso de você

Nenhuma bloqueia começar a Fase A, mas todas mudam a Fase C ou D.

1. **Um atendente pertence a um departamento só, ou a vários?**
   O texto diz "seu departamento", no singular — assumi **um**. Vários viraria
   tabela N:N e complica a fila.

2. ~~Admin não visualiza superadmin: a pessoa ou as conversas?~~
   **Respondido:** as duas. Departamento **Administração Geral**, com
   `is_restricted`. Ver seção 3.2.

3. ~~Super_admin tem caixa própria?~~ **Respondido:** sim.

3b. **Aberto, e é o que importa agora:** como o contato sigiloso chega sem
    passar pela fila geral? A lista de telefones (`contact_routing_rules`) é a
    recomendação, mas ela não cobre o primeiro contato desconhecido. Ver 3.2.

4. **Quem cria super_admin?** Só outro super_admin? E se o único sair da
   empresa? (Recomendo: o primeiro usuário da instância vira `super_admin` em
   vez de `admin`, e só super_admin cria super_admin.)

5. **Supervisor cadastra atendente do próprio departamento?** A descrição dá a
   entender que não — quem cadastra é admin. Confirmar.

6. **Triagem** — resolvido em parte na seção 3.1: como o número é único, a
   conversa nasce sem departamento. Falta decidir se, no começo, ela fica numa
   **fila geral** para alguém triar, ou se cai direto num **departamento
   padrão**. A fila geral dá controle; o padrão evita conversa esquecida.

7. **Quem tria?** Só admin/super_admin, ou um departamento de recepção com
   supervisor próprio?

---

## 8. Riscos

| Risco | Por quê | Mitigação |
|---|---|---|
| **Inbox vazio no deploy** | policy nova + `department_id` nulo | backfill obrigatório na Fase A |
| **Vazamento entre departamentos** | uma policy esquecida numa tabela | teste por papel; varrer toda tabela com `USING (true)` |
| **Inbox lento** | consulta a `app_users` por linha | função `STABLE` + índices |
| **JWT defasado** | papel/departamento no `app_metadata` só troca ao renovar sessão | preferir a opção B; forçar refresh ao mudar papel |
| **Enum em transação** | `ADD VALUE` não roda junto com o uso | migration separada |
| **Base de migrations** | isso soma ~6 às 69 atuais | reforça a Fase 4 (baseline) do plano principal |
| **Conversa nova invisível** | número único ⇒ chega sem departamento | `department_id IS NULL` explícito na policy de quem tria |
| **Fila geral esquecida** | ninguém dono da triagem | `is_default` como rede, ou responsável nomeado |

---

## 9. Ordem sugerida

Antes da Fase A, fazer o **baseline das migrations** (item 1 da Fase 4 do
`PLANEJAMENTO.md`). Este trabalho acrescenta seis migrations à cadeia, e várias
delas mexem em policies que já foram reescritas duas vezes na história do
projeto. Consolidar antes deixa o diff legível e a instalação nova sã.

Se a urgência não permitir, dá para inverter — mas aí o baseline vira dívida
que só cresce.
