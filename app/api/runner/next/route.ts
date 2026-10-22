import { handle, requireToken } from '@/lib/http';
import { getStore, Runner } from '@/lib/store';
import { pickable } from '@/lib/logic.mjs';

export const dynamic = 'force-dynamic';

// GET /api/runner/next?runner=claude|cursor → the oldest ticket waiting for an agent on that runner, or null.
export async function GET(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  const runner = (new URL(req.url).searchParams.get('runner') || 'claude') as Runner;
  return handle(async () => {
    const board = await getStore().read();
    const mine = Object.values(board.tickets).filter((t) => (t.runner ?? 'claude') === runner);
    return { ticket: pickable(mine) };
  });
}
