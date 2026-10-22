import pg from 'pg';
import {
  Board, ConflictError, Decision, LogDoc, NotFoundError, Run, RunnerStatus, Store, Ticket,
} from './types';

const { Pool } = pg;

// Keep in sync with db/schema.sql (inlined so Vercel serverless bundles it).
const SCHEMA = `
create table if not exists tickets (
  id text primary key,
  body jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists decisions (
  id text primary key,
  body jsonb not null,
  version integer not null default 1
);
create table if not exists ticket_log (
  ticket_id text primary key,
  entries jsonb not null default '[]',
  version integer not null default 1
);
create table if not exists runs (
  id uuid primary key,
  ticket_id text not null,
  body jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists runs_ticket on runs (ticket_id, created_at desc);
create table if not exists runner_status (
  id smallint primary key default 1 check (id = 1),
  last_seen_at timestamptz not null,
  host text not null,
  busy_with text
);
`;

// Postgres store for Vercel (Neon). Same contract as FileStore: versions, ConflictError, NotFoundError.
export class PgStore implements Store {
  private pool: pg.Pool;
  private ready: Promise<void>;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 3, ssl: url.includes('sslmode=require') || url.includes('neon.tech') ? { rejectUnauthorized: false } : undefined });
    this.ready = this.ensureSchema();
  }

  private async ensureSchema() {
    await this.pool.query(SCHEMA);
  }

  private async q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) {
    await this.ready;
    return this.pool.query<T>(text, params);
  }

  async read(): Promise<Board> {
    const [tickets, decisions, logs, runs, status] = await Promise.all([
      this.q<{ id: string; body: Ticket; version: number }>('select id, body, version from tickets'),
      this.q<{ id: string; body: Decision; version: number }>('select id, body, version from decisions'),
      this.q<{ ticket_id: string; entries: LogDoc['entries']; version: number }>('select ticket_id, entries, version from ticket_log'),
      // Only recent runs: the page polls this every 5 s and old runs carry 50 output lines each.
      this.q<{ id: string; body: Run; version: number }>('select id, body, version from runs order by created_at desc limit 60'),
      this.q<{ last_seen_at: Date; host: string; busy_with: string | null }>('select last_seen_at, host, busy_with from runner_status where id = 1'),
    ]);
    const board: Board = { tickets: {}, decisions: {}, log: {}, runs: {}, runnerStatus: null };
    for (const r of tickets.rows) board.tickets[r.id] = { ...r.body, id: r.id, version: r.version };
    for (const r of decisions.rows) board.decisions[r.id] = { ...r.body, id: r.id, version: r.version };
    for (const r of logs.rows) board.log[r.ticket_id] = { entries: r.entries || [], version: r.version };
    for (const r of runs.rows) board.runs[r.id] = { ...r.body, id: r.id, version: r.version };
    const s = status.rows[0];
    if (s) board.runnerStatus = { lastSeenAt: +new Date(s.last_seen_at), host: s.host, busyWith: s.busy_with };
    return board;
  }

  async patchTicket(id: string, patch: Partial<Ticket>, ifVersion?: number): Promise<Ticket> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<{ body: Ticket; version: number }>('select body, version from tickets where id = $1 for update', [id]);
      if (!cur.rowCount) throw new NotFoundError(`No ticket ${id}`);
      const v = cur.rows[0].version;
      if (ifVersion !== undefined && ifVersion !== v) throw new ConflictError(v);
      const next: Ticket = { ...cur.rows[0].body, ...patch, id, version: v + 1 };
      await client.query(
        'update tickets set body = $2::jsonb, version = $3, updated_at = now() where id = $1',
        [id, JSON.stringify(next), v + 1],
      );
      await client.query('commit');
      return next;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async getLog(id: string): Promise<LogDoc | null> {
    const r = await this.q<{ entries: LogDoc['entries']; version: number }>('select entries, version from ticket_log where ticket_id = $1', [id]);
    return r.rows[0] ? { entries: r.rows[0].entries || [], version: r.rows[0].version } : null;
  }

  async setLog(id: string, doc: LogDoc, ifVersion?: number): Promise<LogDoc> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<{ version: number }>('select version from ticket_log where ticket_id = $1 for update', [id]);
      const v = cur.rows[0]?.version ?? 0;
      if (ifVersion !== undefined && ifVersion !== v) throw new ConflictError(v);
      const next = { entries: doc.entries, version: v + 1 };
      await client.query(
        `insert into ticket_log (ticket_id, entries, version) values ($1, $2::jsonb, $3)
         on conflict (ticket_id) do update set entries = excluded.entries, version = excluded.version`,
        [id, JSON.stringify(doc.entries), next.version],
      );
      await client.query('commit');
      return next;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async putRun(run: Run): Promise<Run> {
    const body = { ...run, version: 1 };
    await this.q(
      `insert into runs (id, ticket_id, body, version) values ($1::uuid, $2, $3::jsonb, 1)
       on conflict (id) do update set body = excluded.body, version = excluded.version`,
      [run.id, run.ticketId, JSON.stringify(body)],
    );
    return body;
  }

  async patchRun(id: string, patch: Partial<Run>): Promise<Run> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<{ body: Run; version: number }>('select body, version from runs where id = $1::uuid for update', [id]);
      if (!cur.rowCount) throw new NotFoundError(`No run ${id}`);
      const v = cur.rows[0].version;
      const next: Run = { ...cur.rows[0].body, ...patch, id, version: v + 1 };
      await client.query('update runs set body = $2::jsonb, version = $3 where id = $1::uuid', [id, JSON.stringify(next), v + 1]);
      await client.query('commit');
      return next;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async heartbeat(status: RunnerStatus): Promise<void> {
    await this.q(
      `insert into runner_status (id, last_seen_at, host, busy_with) values (1, to_timestamp($1::bigint / 1000.0), $2, $3)
       on conflict (id) do update set last_seen_at = excluded.last_seen_at, host = excluded.host, busy_with = excluded.busy_with`,
      [status.lastSeenAt, status.host, status.busyWith],
    );
  }
}
