import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Board, ConflictError, Decision, LogDoc, NotFoundError, Run, RunnerStatus, Store, Ticket } from './types';

// Local JSON store: one file, atomic writes (tmp + rename), one write at a time.
// Only for local development; Vercel needs the Postgres store.
export class FileStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string) {}

  async read(): Promise<Board> {
    const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
    return { tickets: {}, decisions: {}, log: {}, runs: {}, runnerStatus: null, ...raw };
  }

  async readLight(): Promise<Omit<Board, 'log'> & { log?: undefined }> {
    const board = await this.read();
    const runs: Record<string, Run> = {};
    for (const [id, run] of Object.entries(board.runs || {})) {
      runs[id] = { ...run, lastLines: (run.lastLines || []).slice(-20) };
    }
    return {
      tickets: board.tickets,
      decisions: board.decisions,
      runs,
      runnerStatus: board.runnerStatus,
    };
  }

  private write<T>(fn: (b: Board) => T): Promise<T> {
    const job = this.queue.then(async () => {
      const board = await this.read();
      const result = fn(board);
      const tmp = `${this.file}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(board, null, 1));
      await fs.rename(tmp, this.file);
      return result;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  patchTicket(id: string, patch: Partial<Ticket>, ifVersion?: number) {
    return this.write((b) => {
      const t = b.tickets[id];
      if (!t) throw new NotFoundError(`No ticket ${id}`);
      const v = t.version ?? 1;
      if (ifVersion !== undefined && ifVersion !== v) throw new ConflictError(v);
      b.tickets[id] = { ...t, ...patch, id, version: v + 1 };
      return b.tickets[id];
    });
  }

  patchDecision(id: string, patch: Partial<Decision>, ifVersion?: number) {
    return this.write((b) => {
      const d = b.decisions[id];
      if (!d) throw new NotFoundError(`No decision ${id}`);
      const v = d.version ?? 1;
      if (ifVersion !== undefined && ifVersion !== v) throw new ConflictError(v);
      b.decisions[id] = { ...d, ...patch, id, version: v + 1 };
      return b.decisions[id];
    });
  }

  async getLog(id: string) {
    return (await this.read()).log[id] ?? null;
  }

  setLog(id: string, doc: LogDoc, ifVersion?: number) {
    return this.write((b) => {
      const v = b.log[id]?.version ?? (b.log[id] ? 1 : 0);
      if (ifVersion !== undefined && ifVersion !== v) throw new ConflictError(v);
      b.log[id] = { entries: doc.entries, version: v + 1 };
      return b.log[id];
    });
  }

  putRun(run: Run) {
    return this.write((b) => {
      b.runs[run.id] = { ...run, version: 1 };
      return b.runs[run.id];
    });
  }

  patchRun(id: string, patch: Partial<Run>) {
    return this.write((b) => {
      const r = b.runs[id];
      if (!r) throw new NotFoundError(`No run ${id}`);
      b.runs[id] = { ...r, ...patch, id, version: (r.version ?? 1) + 1 };
      return b.runs[id];
    });
  }

  heartbeat(status: RunnerStatus) {
    return this.write((b) => {
      b.runnerStatus = status;
    });
  }
}
