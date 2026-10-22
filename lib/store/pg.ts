import { Board, LogDoc, Run, RunnerStatus, Store, Ticket } from './types';

// TODO(Cursor): Postgres store for Vercel (Neon via Vercel Marketplace), schema in db/schema.sql.
// Same contract as FileStore: versions, ConflictError on a stale ifVersion, NotFoundError.
// Use `pg` with a pooled connection (DATABASE_URL), one statement per method, JSONB `body` columns.
export class PgStore implements Store {
  constructor(private url: string) {}

  private todo(): never {
    throw new Error('PgStore is not implemented yet (see db/schema.sql and README "Next steps")');
  }

  read(): Promise<Board> { return this.todo(); }
  patchTicket(_id: string, _patch: Partial<Ticket>, _ifVersion?: number): Promise<Ticket> { return this.todo(); }
  getLog(_id: string): Promise<LogDoc | null> { return this.todo(); }
  setLog(_id: string, _doc: LogDoc, _ifVersion?: number): Promise<LogDoc> { return this.todo(); }
  putRun(_run: Run): Promise<Run> { return this.todo(); }
  patchRun(_id: string, _patch: Partial<Run>): Promise<Run> { return this.todo(); }
  heartbeat(_status: RunnerStatus): Promise<void> { return this.todo(); }
}
