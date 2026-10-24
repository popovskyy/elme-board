import { handle, requireToken } from '@/lib/http';
import { getStore, Runner } from '@/lib/store';
import { pickable } from '@/lib/logic.mjs';

export const dynamic = 'force-dynamic';

// GET /api/runner/next?runner=claude|cursor → the oldest ticket waiting for an agent on that runner, or null.
// Reads only waiting tickets: the runner calls this every 15 s.
export async function GET(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  const runner = (new URL(req.url).searchParams.get('runner') || 'claude') as Runner;
  return handle(async () => ({ ticket: pickable(await getStore().waitingTickets(runner)) }));
}
