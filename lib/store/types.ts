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
  read(): Promise<Board>;
  patchTicket(id: string, patch: Partial<Ticket>, ifVersion?: number): Promise<Ticket>;
  patchDecision(id: string, patch: Partial<Decision>, ifVersion?: number): Promise<Decision>;
  getLog(id: string): Promise<LogDoc | null>;
  setLog(id: string, doc: LogDoc, ifVersion?: number): Promise<LogDoc>;
  putRun(run: Run): Promise<Run>;
  patchRun(id: string, patch: Partial<Run>): Promise<Run>;
  heartbeat(status: RunnerStatus): Promise<void>;
}
