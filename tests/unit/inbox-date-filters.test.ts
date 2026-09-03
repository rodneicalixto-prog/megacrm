import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FILTERS,
  matchesFilters,
  readFiltersFromParams,
  writeFiltersToParams,
} from '../../src/components/inbox/inbox-filters.ts';
import type { ConversationWithContact } from '../../src/types/inbox.ts';

function conversation(patch: Partial<ConversationWithContact> = {}): ConversationWithContact {
  return {
    id: 'conv-1',
    contact_id: 'contact-1',
    status: 'closed',
    assigned_to: 'user-1',
    assigned_at: null,
    active_deal_id: null,
    ai_paused: true,
    channel: 'evolution',
    last_message_at: '2026-09-02T13:00:00Z',
    unread_count: 0,
    pinned_note: null,
    archived: false,
    priority: 'normal',
    department_id: 'department-1',
    connection_id: 'connection-1',
    closed_at: '2026-09-02T03:30:00Z',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-02T13:00:00Z',
    contact: null,
    lastMessagePreview: null,
    tagIds: [],
    lastInboundAt: null,
    lastOutboundAt: null,
    isFavorite: false,
    ...patch,
  };
}

describe('filtros de data do dashboard', () => {
  test('finalizados hoje usa a data de São Paulo e não todo o histórico encerrado', () => {
    // now fixo (não Date.now()): closedOn é uma data hardcoded, então o teste
    // precisa de um "agora" hardcoded também — Date.now() fazia o teste só
    // passar no dia 2026-09-02 de verdade (ver ISSUES.md).
    const now = new Date('2026-09-02T15:00:00Z').getTime();
    const filters = { ...DEFAULT_FILTERS, queue: 'encerrados' as const, closedOn: '2026-09-02' };

    expect(matchesFilters(conversation(), filters, now, 'user-1')).toBe(true);
    expect(matchesFilters(conversation({ closed_at: '2026-09-02T02:59:59Z' }), filters, now, 'user-1')).toBe(false);
  });

  test('fila Encerrados mostra somente hoje e Histórico recebe os dias anteriores', () => {
    const now = new Date('2026-09-02T15:00:00Z').getTime();
    const encerrados = { ...DEFAULT_FILTERS, queue: 'encerrados' as const };
    const historico = { ...DEFAULT_FILTERS, queue: 'historico' as const };

    expect(matchesFilters(conversation({ closed_at: '2026-09-02T03:00:00Z' }), encerrados, now, 'user-1')).toBe(true);
    expect(matchesFilters(conversation({ closed_at: '2026-09-02T02:59:59Z' }), encerrados, now, 'user-1')).toBe(false);
    expect(matchesFilters(conversation({ closed_at: '2026-09-02T02:59:59Z' }), historico, now, 'user-1')).toBe(true);
    expect(matchesFilters(conversation({ closed_at: '2026-09-02T03:00:00Z' }), historico, now, 'user-1')).toBe(false);
  });

  test('dia do gráfico inclui conversas criadas no dia independentemente do status atual', () => {
    // now fixo pelo mesmo motivo do teste acima — ver ISSUES.md.
    const now = new Date('2026-09-02T15:00:00Z').getTime();
    const filters = { ...DEFAULT_FILTERS, status: [], createdOn: '2026-09-01' };

    expect(matchesFilters(conversation(), filters, now, 'user-1')).toBe(true);
    expect(matchesFilters(conversation({ created_at: '2026-09-02T12:00:00Z' }), filters, now, 'user-1')).toBe(false);
  });

  test('datas persistem na URL e valores inválidos são descartados', () => {
    const params = writeFiltersToParams(new URLSearchParams(), {
      ...DEFAULT_FILTERS,
      closedOn: '2026-09-02',
      createdOn: '2026-09-01',
    });
    expect(params.get('fcl')).toBe('2026-09-02');
    expect(params.get('fcr')).toBe('2026-09-01');
    expect(readFiltersFromParams(params)).toMatchObject({
      closedOn: '2026-09-02',
      createdOn: '2026-09-01',
    });
    expect(readFiltersFromParams(new URLSearchParams('fcl=hoje&fcr=01-09-2026'))).toMatchObject({
      closedOn: null,
      createdOn: null,
    });
  });
});
