import { randomUUID } from 'node:crypto';
import { handle, requireToken } from '@/lib/http';
import { getStore, Run } from '@/lib/store';

// The runner opens a run when it starts an agent on a ticket.
export async function POST(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  const body = (await req.json()) as Pick<Run, 'ticketId' | 'runner' | 'role' | 'pid' | 'branch' | 'model'>;
  return handle(() => getStore().putRun({
    id: randomUUID(), ticketId: body.ticketId, runner: body.runner, role: body.role, pid: body.pid,
    branch: body.branch ?? null, model: body.model,
    status: 'running', startedAt: Date.now(), lastLines: [], stopRequested: false,
  }));
}
