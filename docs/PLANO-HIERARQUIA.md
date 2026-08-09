# Plano — Multi-atendimento por departamento

> Escrito em 2026-08-08 sobre `be7130c`. **Plano, não implementação.** Nada
> aqui está no código.
>
> Substitui a versão anterior deste documento, que partia de um número único
> compartilhado. O modelo mudou para **um número por departamento** — o que
> simplifica o sigilo e desloca o trabalho para outro lugar.

---

## 1. O modelo

**Uma empresa. Vários departamentos. Um número de WhatsApp para cada.**

```
        número A ──→ Vendas    ──→ supervisor ──manual──→ atendente
        número B ──→ Suporte   ──→ supervisor ──manual──→ atendente
        número C ──→ Admin        (departamento do admin)
        número D ──→ Adm. Geral   (super_admin — sigiloso)

                  admin e super_admin acompanham
```

Três regras que decorrem disso:

1. **O número que recebeu é o departamento.** Não existe triagem: a conversa
   nasce sabendo a quem pertence.
2. **O supervisor é o primeiro humano.** A mensagem cai na fila do departamento;
   ele distribui manualmente. O atendente recebe, não escolhe.
3. **Admin e super_admin acompanham.** Observam os departamentos; não são o
   primeiro atendimento.

> **Não é multi-tenant.** É uma organização com vários canais. O
> `drop_multitenant` continua valendo — não há empresa dentro de empresa, e
> nada aqui reverte aquela migração.

### O que este modelo resolve de graça

O desenho anterior (número único) tinha um furo: a conversa do dono passava
pela fila geral, onde o admin lia, antes de virar sigilosa. Precisava de lista
de contatos, roteamento na entrada, e ainda assim vazava o primeiro contato
desconhecido.

**Com número próprio, isso desaparece.** A conversa do super_admin nunca toca a
infraestrutura dos outros. Não é policy protegendo o dado — o dado nunca esteve
ao alcance. Sigilo por arquitetura, não por permissão.

---

## 1.1. Escopo desta fase

**Fora, por decisão:**

- **Agente de IA.** Já desligado (`20260808140000`). O atendimento é 100% humano.
- **API oficial (Zernio).** Só a rota Evolution. Fase futura, a repensar.

Isso simplifica o plano — mas tem duas consequências que não são óbvias.

### Consequência 1 — Campanhas e Templates ficam inertes

**12 das 22 Edge Functions dependem do Zernio.** Sem a rota oficial, estas não
têm o que fazer:

| Função | O que deixa de existir |
|---|---|
| `dispatch-campaign` | disparo em massa (usa Broadcasts do Zernio) |
| `submit-template` · `sync-template-status` | aprovação de template na Meta |
| `sync-broadcast-status` | status dos disparos |
| `repurchase-dispatch` | recompra (depende de broadcast) |
| `zernio-number-status` · `test-zernio-connection` | saúde do número oficial |

Ou seja: **Campanhas, Templates e Recompra saem do produto** enquanto for só
Evolution. Não é bug — disparo em massa é feito de template aprovado pela Meta,
que só existe na API oficial. Vale saber que o menu vai mostrar funcionalidade
que não opera.

> Baileys também não entrega `ctwa_clid`, então a atribuição de anúncio
> Click-to-WhatsApp fica só com o código de rastreio.

### Consequência 2 — 🔴 Enviar mídia pela inbox está quebrado hoje

`send-operator-media` **não tem caminho para a Evolution**. Ele importa só o
client do Zernio; nenhuma linha olha `conversation.channel`.

O `send-operator-message` (texto) ganhou o desvio para a Evolution; o de **mídia
não**. Na prática: o operador manda texto, mas **anexar imagem ou arquivo falha**.

Isso não é do plano de departamentos — **é um defeito ativo na configuração que
vocês já estão usando**. O adapter da Evolution já sabe enviar mídia
(`sendMedia` / `sendWhatsAppAudio`); falta ligar os dois. Trabalho pequeno, e
deveria vir antes de qualquer fase deste documento.

---

## 2. Onde o trabalho realmente está

Duas frentes, e a segunda é a que ninguém espera.

### Frente 1 — Papéis e visibilidade (esperada)

Hoje: 2 papéis, nenhum departamento, e todas as policies de leitura são
`USING (true)` — qualquer autenticado lê tudo.

### Frente 2 — Várias conexões de WhatsApp (a pesada)

**Hoje o sistema é de uma conexão só.** As credenciais são três chaves soltas
num KV singleton:

```
public.app_settings          -- KV criptografado, uma linha por chave
├── evolution_server_url
├── evolution_api_key
└── evolution_instance
```

Não existe noção de "várias contas". `loadEvolutionProvider()` lê essas três e
devolve **o** provider. Para N departamentos, isso precisa virar N linhas — e
todo caminho de envio e recebimento passa a perguntar "de qual número?".

Essa é a maior parte do esforço, e não aparece no pedido original.

### Uma boa notícia

O payload da Evolution **já traz o nome da instância**:

```json
{ "event": "messages.upsert", "instance": "vendas", "data": { … } }
```

Hoje o adapter ignora esse campo. Passando a lê-lo, **um único webhook atende
todos os números** — o nome da instância diz o departamento. Não precisa de URL
por departamento nem de endpoint novo.

---

## 3. Papéis

| Papel | Escopo |
|---|---|
| **super_admin** | dono. Vê tudo. Número e departamento próprios, sigilosos |
| **admin** | vê todos os departamentos **menos** o do super_admin. Número próprio |
| **supervisor** | só o próprio departamento. Distribui as conversas |
| **user** (atendente) | só o que foi atribuído a ele |

Legenda: ✅ pode · ⬜ não pode · 🔶 só no próprio departamento

| Capacidade | super_admin | admin | supervisor | user |
|---|:--:|:--:|:--:|:--:|
| Configurar a empresa | ✅ | ✅ | ⬜ | ⬜ |
| Criar/editar departamentos | ✅ | ✅ | ⬜ | ⬜ |
| Conectar número ao departamento | ✅ | ✅ | ⬜ | ⬜ |
| Cadastrar supervisor | ✅ | ✅ | ⬜ | ⬜ |
| Cadastrar atendente | ✅ | ✅ | 🔶 | ⬜ |
| Acompanhar atendimentos | ✅ | ✅ | 🔶 | ⬜ |
| **Distribuir da fila** | ✅ | ✅ | 🔶 | ⬜ |
| Responder / status / notas / finalizar | ✅ | ✅ | ✅ | ✅ |
| Transferir | ✅ | ✅ | ✅ | ✅ |
| Métricas | ✅ | ✅ | 🔶 | ⬜ |
| **Ver o usuário super_admin** | ✅ | ⬜ | ⬜ | ⬜ |
| **Ler a Administração Geral** | ✅ | ⬜ | ⬜ | ⬜ |

> `operator` (existente) vira `user`. **Manter o valor no enum** — renomear
> quebraria os JWTs já emitidos, que carregam `role: 'operator'` no
> `app_metadata` até a sessão renovar.

---

## 4. Modelo de dados

```sql
departments
├── id             UUID PK
├── name           TEXT UNIQUE          -- Vendas, Suporte, Administração Geral
├── is_active      BOOLEAN DEFAULT true
├── is_restricted  BOOLEAN DEFAULT false -- admin NÃO lê (Adm. Geral)
└── created_at

department_connections        -- o número de cada departamento
├── department_id   UUID PK REFERENCES departments
├── instance        TEXT UNIQUE  -- nome da instância = chave de roteamento
├── server_url      TEXT
├── api_key_encrypted TEXT   -- mesmo AES-256-GCM do app_settings
├── phone_number    TEXT     -- exibição
└── connected_at

conversation_transfers        -- histórico; hoje não existe
├── conversation_id, from_department_id, to_department_id
├── from_user_id, to_user_id, moved_by, reason, created_at
```

Colunas novas:

```sql
app_users.department_id      UUID   -- supervisor e atendente: UM departamento
conversations.department_id  UUID NOT NULL  -- nunca nulo: vem do número
```

### 🔴 O bloqueio

```sql
ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_id_key UNIQUE (contact_id);
```

**Uma conversa por contato, na instalação inteira.**

O mesmo cliente falando com Vendas e depois com Suporte quebra o insert — ou
pior, as duas viram uma conversa só, misturando departamentos e furando o
recorte de visibilidade.

Precisa virar `UNIQUE (contact_id, department_id)`. A migration é curta; o
custo está em **todo lugar que assume "a conversa do contato" no singular** —
já localizei em `whatsapp-inbound` (`.eq('contact_id', …).maybeSingle()`) e no
`DealDrawer`. Varrer antes de mexer.

### Sobre as credenciais

Reusar o `encrypt`/`decrypt` de `src/lib/credentials.ts` (AES-256-GCM com a
`CRYPTO_KEY`) na coluna `api_key_encrypted`. Não inventar cofre novo — é o
mesmo esquema, em outra tabela, porque agora a credencial pertence a uma
**linha** e não à instalação.

Sem coluna `provider`: **só Evolution nesta fase**. Se a rota oficial voltar, é
um `ALTER TABLE ADD COLUMN` — barato depois, e carregar agora faria todo caminho
ramificar sobre um valor que nunca muda.

---

## 5. Recorte de leitura

```sql
-- STABLE: o Postgres avalia uma vez por query, não por linha.
CREATE FUNCTION whatsapp_hub.current_user_department() RETURNS UUID
  STABLE LANGUAGE sql AS $$
    SELECT department_id FROM whatsapp_hub.app_users WHERE user_id = auth.uid();
  $$;

CREATE POLICY conversations_select ON whatsapp_hub.conversations
  FOR SELECT TO authenticated USING (
    whatsapp_hub.current_user_role() = 'super_admin'
    OR (whatsapp_hub.current_user_role() = 'admin'
        AND NOT whatsapp_hub.department_is_restricted(department_id))
    OR department_id = whatsapp_hub.current_user_department()
  );
```

`messages` não tem `department_id`; o filtro vai por `EXISTS` na conversa.
**Índice em `conversations(department_id)` é obrigatório**, não opcional.

E o atendente vê menos que o supervisor dentro do mesmo departamento — só o que
está atribuído a ele:

```sql
OR (whatsapp_hub.current_user_role() = 'operator' AND assigned_to = auth.uid())
```

Esconder super_admin da lista de pessoas é policy separada, em `app_users`:

```sql
USING (whatsapp_hub.current_user_role() = 'super_admin' OR role <> 'super_admin')
```

---

## 6. Fases

### ✅ Fase 0 — Envio de mídia na Evolution — feita

`send-operator-media` só falava Zernio; anexar imagem ou arquivo falhava. O
texto tinha ganhado o desvio para a Evolution na troca de provedor, a mídia não.

A Evolution não tem endpoint de upload — o `/message/sendMedia` recebe uma URL.
Base64 obrigaria trafegar ~33 MB num corpo JSON e ainda deixaria a thread sem
imagem para exibir. Então o arquivo passa a viver no bucket
`whatsapp-hub-outbound-media` (público, 25 MB), e a mesma URL serve à Evolution
e ao CRM.

Falha no envio depois do upload remove o arquivo — senão ele ficaria no bucket
para sempre, sem mensagem que o referenciasse.

10 checks, incluindo a rota de voz (`sendWhatsAppAudio`) e os dois caminhos de
falha.

### ✅ Fase A — Departamentos e conexões — feita (backend)

1. ✅ Enum em migration própria (`20260808160000`).
2. ✅ `departments`, `department_connections`, `app_users.department_id`,
   `conversations.department_id` (`20260808170000`).
3. ✅ `UNIQUE (contact_id, department_id)` — a constraint antiga era por
   contato na instalação inteira.
4. ✅ Backfill de "Geral" em conversas e usuários, e só então `SET NOT NULL`.
5. ✅ **Administração Geral** com `is_restricted`; o dono vira `super_admin`,
   uma vez só, com marca em `_bootstrap_state` (`20260808180000`).
6. ✅ `current_user_department()`, `department_is_restricted()`,
   `sees_all_departments()` — `STABLE`, uma avaliação por query.
7. ✅ Tipos de papel alargados no front e nas functions; `requireAdmin` aceita
   `super_admin`; novo `requireSupervisor`.
8. ✅ Convite carrega departamento, e **só super_admin convida super_admin** —
   sem isso um admin escalaria o próprio nível convidando um e entrando com ele.

> `department_connections` fica **vazia** nesta fase, e `server_url` /
> `api_key_encrypted` nulos significam "usar a credencial global". É o que
> mantém a instalação atual funcionando enquanto o roteamento por número não
> existe. SQL não consegue semear esses valores: estão cifrados e a `CRYPTO_KEY`
> vive na aplicação.

### Fase B — Roteamento por número · ~3–4 dias

6. `whatsapp-inbound` lê `payload.instance` → resolve o departamento →
   `conversations.department_id`.
7. Outbound envia pela conexão **do departamento da conversa**, não pela
   credencial global.
8. Rejeitar instância desconhecida com log — nunca cair num departamento
   arbitrário.
9. Testes: mensagem em cada instância cai no departamento certo; resposta sai
   pelo número certo. O dublê da Fase 3 já suporta isso.

### Fase C — Visibilidade · ~3 dias 🔴 crítica

10. Reescrever `SELECT` de `conversations`, `messages`, `contacts` e funil.
11. Restrição do departamento sigiloso — **em toda tabela**. É a regra mais
    fácil de esquecer numa, e a de pior consequência.
12. Policy de `app_users`.
13. Índices.
14. **Teste com usuário de cada papel.** Segurança não testada é segurança que
    não existe; aqui o modo de falha é vazar conversa entre departamentos.

### Fase D — Fila e distribuição · ~3 dias

15. Fila do departamento = conversas sem `assigned_to`.
16. Ação de distribuir (supervisor → atendente) e transferir (entre
    departamentos), com histórico em `conversation_transfers`.
17. Super_admin fora da lista de destinos.

### Fase E — Interface · ~4–5 dias

18. CRUD de departamentos + conectar número por departamento (reaproveita o card
    da Evolution que já existe, agora um por departamento).
19. Convite com papel **e** departamento.
20. Inbox com seletor de departamento; supervisor vê o seu, admin escolhe.
21. Sidebar por papel — atendente não vê Campanhas, Configurações, Agente de IA.

> Esconder item de menu **não é permissão**. Quem barra é a RLS; o menu só evita
> oferecer o que vai dar erro.

### Fase F — Métricas por departamento · ~2 dias

22. `useDashboardMetrics` e `useSalesDashboard` filtrados. Supervisor vê o seu.

**Total: 17–21 dias** (menor que a estimativa anterior: sem IA e sem rota
oficial, a Fase B lida com um provedor só). Fases A, B e C saem juntas — meio
caminho deixa o sistema pior que hoje.

---

## 7. Riscos

| Risco | Por quê | Mitigação |
|---|---|---|
| **Inbox vazio no deploy** | policy nova + `department_id` nulo | backfill na Fase A, obrigatório |
| **Conversa duplicada / misturada** | `UNIQUE (contact_id)` | trocar a constraint **antes** da Fase B |
| **Vazamento entre departamentos** | uma policy esquecida | teste por papel; varrer toda tabela com `USING (true)` |
| **Resposta pelo número errado** | outbound ainda global | Fase B trata os dois sentidos juntos |
| **Instância órfã** | número conectado sem departamento | rejeitar e logar, nunca adivinhar |
| **Enum em transação** | `ADD VALUE` não roda junto com o uso | migration separada |
| **Inbox lento** | `app_users` consultado por linha | função `STABLE` + índices |
| **+10 migrations** | vão para as 69 atuais | fazer o baseline (Fase 4) antes |

---

## 8. Perguntas abertas

1. **Supervisor cadastra atendente do próprio departamento**, ou só admin
   cadastra? A descrição sugere só admin.
2. **Atendente transfere entre departamentos**, ou só devolve para o supervisor?
3. **Quem cria super_admin?** Recomendo: o primeiro usuário da instalação vira
   `super_admin` (hoje vira `admin`), e só super_admin cria outro.
4. ~~Agente de IA por departamento?~~ **Fora de escopo** — sem agente nesta
   fase. Quando voltar, `ai_agent_config` é singleton e vai precisar de uma
   linha por departamento.
5. ~~Campanhas por departamento?~~ **Fora de escopo** — campanhas dependem da
   API oficial, que também saiu.
6. **Esconder no menu o que não opera?** Campanhas, Templates e Recompra ficam
   inertes sem a rota oficial. Ocultar por enquanto, ou deixar visível com aviso?

---

## 9. Ordem recomendada

Fazer o **baseline das migrations** (Fase 4 do `PLANEJAMENTO.md`) antes de
começar. Este trabalho acrescenta ~10 migrations à cadeia de 69, e várias mexem
em policies já reescritas duas vezes na história do projeto. Consolidar antes
deixa o diff legível e a instalação nova sã.

Se a urgência não permitir, dá para inverter — mas o baseline vira dívida que só
cresce.
