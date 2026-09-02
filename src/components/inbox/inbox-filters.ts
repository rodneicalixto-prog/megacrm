import type { ConversationWithContact } from '@/types/inbox';

// Estado dos filtros do inbox (Módulo 7). O canal fica aqui junto para
// persistência unificada, mas é renderizado como segmented control à parte.
export type ChannelFilter = 'all' | 'whatsapp' | 'instagram' | 'evolution';
export type Atendente = 'ia' | 'humano';
export type StatusBucket = 'abertas' | 'fechadas' | 'arquivadas';
export type JanelaFilter = 'any' | 'dentro' | 'fora';

// Filas da coluna esquerda. Uma de cada vez — são recortes concorrentes da
// mesma lista, e deixá-las combináveis produziria interseções vazias que o
// atendente leria como "não tem nada", não como "esse cruzamento não existe".
export type QueueId =
  | 'todos'
  | 'nao_atribuidos'
  | 'meus'
  | 'aguardando'
  | 'em_atendimento'
  | 'aguardando_cliente'
  | 'encerrados'
  | 'historico'
  | 'prioridade_alta'
  | 'nao_lidos'
  | 'favoritos';

export const QUEUES: Array<{ id: QueueId; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'nao_atribuidos', label: 'Não atribuídos' },
  { id: 'meus', label: 'Meus atendimentos' },
  { id: 'aguardando', label: 'Aguardando' },
  { id: 'em_atendimento', label: 'Em atendimento' },
  { id: 'aguardando_cliente', label: 'Aguardando cliente' },
  { id: 'encerrados', label: 'Encerrados hoje' },
  { id: 'historico', label: 'Histórico' },
  { id: 'prioridade_alta', label: 'Prioridade alta' },
  { id: 'nao_lidos', label: 'Não lidos' },
  { id: 'favoritos', label: 'Favoritos' },
];

export interface InboxFilterState {
  queue: QueueId;
  channel: ChannelFilter;
  // Linha (department_connections.id) que recebeu a conversa. Um departamento
  // pode ter dezenas de números, então filtrar por departamento não é o mesmo
  // que filtrar por número.
  connectionId: string | 'any';
  departmentId: string | 'any';
  atendente: Atendente[]; // vazio = qualquer
  status: StatusBucket[]; // default ['abertas']; vazio = qualquer
  assigned: string | 'unassigned' | 'any';
  tagIds: string[]; // any-match; vazio = qualquer
  janela: JanelaFilter;
  // Recortes de data vindos dos cards do dashboard. YYYY-MM-DD no fuso de
  // São Paulo, o mesmo usado pela RPC attendance_dashboard.
  closedOn: string | null;
  createdOn: string | null;
}

export const DEFAULT_FILTERS: InboxFilterState = {
  queue: 'todos',
  channel: 'all',
  connectionId: 'any',
  departmentId: 'any',
  atendente: [],
  status: ['abertas'],
  assigned: 'any',
  tagIds: [],
  janela: 'any',
  closedOn: null,
  createdOn: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// O inbox e operacional, nao historico: todas as filas exibem somente
// atendimentos que tiveram atividade no dia local do operador. Para conversas
// encerradas, o fechamento tambem conta como atividade, mesmo que a ultima
// mensagem tenha sido enviada no dia anterior.
export function hasActivityToday(c: ConversationWithContact, now: number): boolean {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const timestamps = [c.last_message_at, c.status === 'closed' ? c.closed_at : null];
  return timestamps.some((value) => {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return timestamp >= start.getTime() && timestamp < end.getTime();
  });
}

// Bucket de status derivado: arquivada domina; senão closed → fechadas; senão
// aberta (ai_active | human_active).
function statusBucket(c: ConversationWithContact): StatusBucket {
  if (c.archived) return 'arquivadas';
  if (c.status === 'closed') return 'fechadas';
  return 'abertas';
}

export function isWithinWindow(c: ConversationWithContact, now: number): boolean {
  return Boolean(c.lastInboundAt) && now - new Date(c.lastInboundAt as string).getTime() < DAY_MS;
}

// Quem falou por último. É o que separa "aguardando" (a bola está com a gente)
// de "aguardando cliente" (a bola está com ele) — sem isso as duas filas
// mostrariam a mesma coisa.
export function lastSpeaker(c: ConversationWithContact): 'contato' | 'nos' | null {
  const inbound = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : null;
  const outbound = c.lastOutboundAt ? new Date(c.lastOutboundAt).getTime() : null;
  if (inbound === null && outbound === null) return null;
  if (outbound === null) return 'contato';
  if (inbound === null) return 'nos';
  return inbound >= outbound ? 'contato' : 'nos';
}

// Predicado da fila selecionada. Separado de matchesFilters porque a fila
// manda no eixo de status: pedir "Encerrados" e continuar aplicando o default
// ['abertas'] devolveria lista vazia sempre.
export function matchesQueue(
  c: ConversationWithContact,
  queue: QueueId,
  userId: string | null,
  now: number = Date.now(),
): boolean {
  switch (queue) {
    case 'todos':
      // Nao filtra nada: o eixo de status, cujo default e ['abertas'], e quem
      // esconde arquivadas. Excluir aqui tambem tornaria o filtro
      // status=arquivadas inalcancavel.
      return true;
    case 'nao_atribuidos':
      return !c.archived && c.status !== 'closed' && !c.assigned_to;
    case 'meus':
      return !c.archived && Boolean(userId) && c.assigned_to === userId;
    case 'aguardando':
      // Cliente falou por último: ninguém respondeu ainda.
      return !c.archived && c.status !== 'closed' && lastSpeaker(c) === 'contato';
    case 'em_atendimento':
      return !c.archived && c.status === 'human_active';
    case 'aguardando_cliente':
      return !c.archived && c.status !== 'closed' && lastSpeaker(c) === 'nos';
    case 'encerrados':
      return !c.archived && c.status === 'closed' && Boolean(c.closed_at)
        && dateInSaoPaulo(c.closed_at as string) === dateInSaoPaulo(new Date(now).toISOString());
    case 'historico':
      return !c.archived && c.status === 'closed' && Boolean(c.closed_at)
        && dateInSaoPaulo(c.closed_at as string) < dateInSaoPaulo(new Date(now).toISOString());
    case 'prioridade_alta':
      return !c.archived && c.priority === 'alta';
    case 'nao_lidos':
      return !c.archived && c.status !== 'closed' && c.unread_count > 0;
    case 'favoritos':
      return c.isFavorite;
    default:
      return true;
  }
}

// A fila já decide o status; aplicar o bucket por cima só faz sentido em
// 'todos', onde ele é o recorte padrão de "não mexer no arquivado".
function queueOwnsStatus(queue: QueueId): boolean {
  return queue !== 'todos';
}

// Todos os eixos MENOS a fila. A barra lateral conta com isto: um contador que
// ignorasse os filtros ativos anunciaria 12 e abriria uma lista de 3.
export function matchesNonQueueFilters(
  c: ConversationWithContact,
  f: InboxFilterState,
  now: number,
): boolean {
  if (!hasActivityToday(c, now)) return false;

  if (f.channel !== 'all' && c.channel !== f.channel) return false;

  if (f.connectionId !== 'any' && c.connection_id !== f.connectionId) return false;

  if (f.departmentId !== 'any' && c.department_id !== f.departmentId) return false;

  if (!queueOwnsStatus(f.queue) && f.status.length > 0 && !f.status.includes(statusBucket(c))) {
    return false;
  }

  if (f.atendente.length > 0) {
    const want: string[] = f.atendente.map((a) => (a === 'ia' ? 'ai_active' : 'human_active'));
    if (!want.includes(c.status)) return false;
  }

  if (f.assigned === 'unassigned') {
    if (c.assigned_to) return false;
  } else if (f.assigned !== 'any') {
    if (c.assigned_to !== f.assigned) return false;
  }

  if (f.tagIds.length > 0) {
    const hit = c.tagIds.some((t) => f.tagIds.includes(t));
    if (!hit) return false;
  }

  if (f.janela !== 'any') {
    const within = isWithinWindow(c, now);
    if (f.janela === 'dentro' && !within) return false;
    if (f.janela === 'fora' && within) return false;
  }

  if (f.closedOn && (!c.closed_at || dateInSaoPaulo(c.closed_at) !== f.closedOn)) return false;
  if (f.createdOn && dateInSaoPaulo(c.created_at) !== f.createdOn) return false;

  return true;
}

function dateInSaoPaulo(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Predicado central: uma conversa passa se satisfaz TODOS os eixos ativos (AND).
export function matchesFilters(
  c: ConversationWithContact,
  f: InboxFilterState,
  now: number,
  userId: string | null = null,
): boolean {
  return matchesQueue(c, f.queue, userId, now) && matchesNonQueueFilters(c, f, now);
}

// Quantos eixos (fora canal e fila) estão ativos — alimenta o badge do botão
// Filtros.
export function activeFilterCount(f: InboxFilterState): number {
  let n = 0;
  if (f.atendente.length > 0) n++;
  // status conta como ativo só quando difere do default (['abertas']).
  const isDefaultStatus =
    f.status.length === 1 && f.status[0] === 'abertas';
  if (!isDefaultStatus) n++;
  if (f.assigned !== 'any') n++;
  if (f.tagIds.length > 0) n++;
  if (f.janela !== 'any') n++;
  if (f.departmentId !== 'any') n++;
  if (f.connectionId !== 'any') n++;
  if (f.closedOn) n++;
  if (f.createdOn) n++;
  return n;
}

// ---- Persistência em querystring ------------------------------------------
// Namespace f* para não colidir com ?conversation= / ?contact= já usados.
export function readFiltersFromParams(sp: URLSearchParams): InboxFilterState {
  const csv = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);
  const ch = sp.get('fch');
  const channel: ChannelFilter =
    ch === 'whatsapp' || ch === 'instagram' || ch === 'evolution' ? ch : 'all';
  const q = sp.get('fq');
  const queue = (QUEUES.some((x) => x.id === q) ? q : 'todos') as QueueId;
  const atendente = csv(sp.get('fat')).filter(
    (v): v is Atendente => v === 'ia' || v === 'humano',
  );
  const status = sp.has('fst')
    ? csv(sp.get('fst')).filter(
        (v): v is StatusBucket => v === 'abertas' || v === 'fechadas' || v === 'arquivadas',
      )
    : DEFAULT_FILTERS.status;
  const assigned = sp.get('fas') ?? 'any';
  const tagIds = csv(sp.get('ftg'));
  const jw = sp.get('fjw');
  const janela: JanelaFilter = jw === 'dentro' || jw === 'fora' ? jw : 'any';
  return {
    queue,
    channel,
    connectionId: sp.get('fcn') ?? 'any',
    departmentId: sp.get('fdp') ?? 'any',
    atendente,
    status,
    assigned,
    tagIds,
    janela,
    closedOn: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('fcl') ?? '') ? sp.get('fcl') : null,
    createdOn: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('fcr') ?? '') ? sp.get('fcr') : null,
  };
}

// Aplica os params de filtro num objeto de params existente (preserva os
// demais, ex.: conversation). Só grava o que difere do default.
export function writeFiltersToParams(
  sp: URLSearchParams,
  f: InboxFilterState,
): URLSearchParams {
  const next = new URLSearchParams(sp);
  const setOrDel = (key: string, val: string, on: boolean) => {
    if (on) next.set(key, val);
    else next.delete(key);
  };
  setOrDel('fq', f.queue, f.queue !== 'todos');
  setOrDel('fch', f.channel, f.channel !== 'all');
  setOrDel('fcn', f.connectionId, f.connectionId !== 'any');
  setOrDel('fdp', f.departmentId, f.departmentId !== 'any');
  setOrDel('fat', f.atendente.join(','), f.atendente.length > 0);
  const isDefaultStatus = f.status.length === 1 && f.status[0] === 'abertas';
  setOrDel('fst', f.status.join(','), !isDefaultStatus);
  setOrDel('fas', f.assigned, f.assigned !== 'any');
  setOrDel('ftg', f.tagIds.join(','), f.tagIds.length > 0);
  setOrDel('fjw', f.janela, f.janela !== 'any');
  setOrDel('fcl', f.closedOn ?? '', Boolean(f.closedOn));
  setOrDel('fcr', f.createdOn ?? '', Boolean(f.createdOn));
  return next;
}
