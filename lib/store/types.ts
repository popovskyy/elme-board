export type Status = 'todo' | 'in_progress' | 'in_qa' | 'review' | 'done' | 'blocked';
export type Holder = 'fe' | 'be' | 'qa' | 'idea' | 'seo' | 'roman' | null;
export type Runner = 'claude' | 'cursor';

export type QaCheck = { state: 'passed' | 'failed' | 'not_checked'; by: string; at: number } | null;

export type Ticket = {
  id: string;
  title: string;
  kind: 'FE' | 'UX' | 'BE';
  epic: string;
  order: number;
  wave?: number;
  waveName?: string;
  seq?: number;
  deps: string[];
  decisions: string[];
  extends: string[];
  scope: string;
  ref: string;
  qa: string[];
  status: Status;
  holder: Holder;
  waiting: boolean;
  runner?: Runner;
  prev: { status: Status; holder: Holder } | null;
  branch: string | null;
  builder?: 'fe' | 'be';
  qaVerdict: 'passed' | 'failed' | null;
  /** Marketing agent on a done ticket: ship = leave it, push = worth another design pass. */
  ideaVerdict?: 'ship' | 'push' | null;
  qaChecks: QaCheck[];
  updatedAt: number;
  version?: number;
  /** Set by Done when the ticket has a feature branch; PC runner merges into main. */
  mergeRequested?: boolean;
  mergedAt?: number | null;
  mergeError?: string | null;
  /** Roman's choice on a branch conflict, read once by the PC runner. */
  resetBranch?: boolean;
  resolveConflict?: boolean;
  stashFirst?: boolean;
  skipChecks?: boolean;
};

export type Decision = {
  id: string;
  title: string;
  prod: string;
  options: string;
  status: 'open' | 'decided';
  chosen: string | null;
  affects: string;
  version?: number;
};

export type LogEntry = { at: number; who: string; kind: string; text: string; code?: string };
export type LogDoc = { entries: LogEntry[]; version?: number };

export type Run = {
  id: string;
  ticketId: string;
  runner: Runner;
  role: 'fe' | 'be' | 'qa' | 'idea' | 'seo';
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  startedAt: number;
  endedAt?: number;
  pid?: number;
  branch?: string | null;
  model?: string;
  exitCode?: number | null;
  lastLines: string[];
  stopRequested: boolean;
  version?: number;
};

export type RunnerStatus = { lastSeenAt: number; host: string; busyWith: string | null };

export type Board = {
  tickets: Record<string, Ticket>;
  decisions: Record<string, Decision>;
  log: Record<string, LogDoc>;
  runs: Record<string, Run>;
  runnerStatus: RunnerStatus | null;
};

export class ConflictError extends Error {
  constructor(public current: number) {
    super(`Version conflict: current version is ${current}`);
  }
}

export class NotFoundError extends Error {}

export interface Store {
  /** Full board including every ticket_log — avoid on the 5s poll (burns Neon transfer). */
  read(): Promise<Board>;
  /**
   * Poll payload: tickets + decisions + runner + recent runs (lastLines truncated).
   * Logs stay on GET /api/log/:id only.
   */
  readLight(): Promise<Omit<Board, 'log'> & { log?: undefined }>;
  patchTicket(id: string, patch: Partial<Ticket>, ifVersion?: number): Promise<Ticket>;
  patchDecision(id: string, patch: Partial<Decision>, ifVersion?: number): Promise<Decision>;
  getLog(id: string): Promise<LogDoc | null>;
  setLog(id: string, doc: LogDoc, ifVersion?: number): Promise<LogDoc>;
  putRun(run: Run): Promise<Run>;
  patchRun(id: string, patch: Partial<Run>): Promise<Run>;
  heartbeat(status: RunnerStatus): Promise<void>;
  /** Cheap reads for pollers (runner, CLI, page): one row or a filtered few, never the whole board. */
  getTicket(id: string): Promise<Ticket | null>;
  getRun(id: string): Promise<Run | null>;
  waitingTickets(runner: Runner): Promise<Ticket[]>;
  mergeTickets(): Promise<Ticket[]>;
  /** Changes whenever any ticket or decision is written; lets the page skip unchanged polls. */
  boardSig(): Promise<string>;
  /** Active and recently ended runs (lastLines trimmed) plus the runner heartbeat. */
  readRuntime(): Promise<Pick<Board, 'runs' | 'runnerStatus'>>;
  /** New ticket from the board; the id is the next free number for its kind (FE-60, BE-01, …). */
  createTicket(input: NewTicket): Promise<Ticket>;
}

export type NewTicket = Pick<Ticket, 'title' | 'kind' | 'scope' | 'ref' | 'qa' | 'deps'> & {
  epic: string; wave?: number; waveName?: string; runner?: Runner;
};

/** Fills the fields every ticket carries. `seq` puts it last in its wave. */
export function buildTicket(id: string, input: NewTicket, seq: number, order: number): Ticket {
  return {
    id, title: input.title.trim(), kind: input.kind, epic: input.epic, order, seq,
    wave: input.wave, waveName: input.waveName,
    deps: input.deps || [], decisions: [], extends: [],
    scope: input.scope || '', ref: input.ref || '', qa: input.qa || [],
    status: 'todo', holder: null, waiting: false, prev: null, branch: null,
    qaVerdict: null, qaChecks: (input.qa || []).map(() => null), updatedAt: Date.now(), runner: input.runner || 'claude',
  };
}

export function nextId(kind: string, ids: string[]): string {
  const n = ids.filter((i) => i.startsWith(`${kind}-`)).map((i) => Number(i.split('-')[1]) || 0);
  return `${kind}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0')}`;
}
