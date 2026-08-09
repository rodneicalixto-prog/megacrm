// Duble em memoria do client Supabase — so o suficiente para as cadeias que as
// Edge Functions realmente usam. Nao e um mock generico: e um banco de mentira
// pequeno, com estado, que responde `.from().select().eq().maybeSingle()`,
// insert (com unique constraint), update e rpc.
//
// Vale mais que um mock de assercao porque o que interessa nesses testes e o
// ESTADO no fim (a conversa ficou pausada? a mensagem entrou?), nao a sequencia
// exata de chamadas.

export type Row = Record<string, unknown>;

interface Result<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  // Colunas com UNIQUE por tabela — usadas para devolver 23505, o codigo que o
  // caminho de idempotencia procura.
  unique: Record<string, string> = { webhook_events: 'zernio_event_id' };
  rpcCalls: Array<{ name: string; args: Row }> = [];
  rpcResults: Record<string, Result> = {};
  private seq = 0;

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map((r) => ({ ...r }));
    return this;
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  from = (table: string) => {
    this.tables[table] ??= [];
    const rows = this.tables[table];

    return {
      select(_cols?: string) {
        const filters: Array<[string, unknown]> = [];
        const q = {
          eq(col: string, value: unknown) {
            filters.push([col, value]);
            return q;
          },
          get matches() {
            return rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          },
          async maybeSingle(): Promise<Result<Row>> {
            return { data: q.matches[0] ?? null, error: null };
          },
          async single(): Promise<Result<Row>> {
            const hit = q.matches[0];
            return hit
              ? { data: hit, error: null }
              : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
          },
          then(res: (r: Result<Row[]>) => unknown) {
            return Promise.resolve({ data: q.matches, error: null }).then(res);
          },
        };
        return q;
      },

      insert: (row: Row) => {
        const uniqueCol = this.unique[table];
        const duplicated =
          uniqueCol !== undefined && rows.some((r) => r[uniqueCol] === row[uniqueCol]);
        const inserted: Row = { id: `${table}-${++this.seq}`, ...row };
        if (!duplicated) rows.push(inserted);

        const err = duplicated
          ? { message: 'duplicate key value violates unique constraint', code: '23505' }
          : null;

        const chain = {
          select(_cols?: string) {
            return {
              async single(): Promise<Result<Row>> {
                return duplicated ? { data: null, error: err } : { data: inserted, error: null };
              },
            };
          },
          then(res: (r: Result<Row>) => unknown) {
            return Promise.resolve({ data: duplicated ? null : inserted, error: err }).then(res);
          },
        };
        return chain;
      },

      update(patch: Row) {
        return {
          eq(col: string, value: unknown) {
            for (const r of rows) if (r[col] === value) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  };

  rpc = async (name: string, args: Row): Promise<Result> => {
    this.rpcCalls.push({ name, args });
    return this.rpcResults[name] ?? { data: null, error: null };
  };
}
