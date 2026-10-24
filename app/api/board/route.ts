import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

// GET /api/board?since=<sig>: when nothing changed since the page's last poll, answer with the cheap part only
// (sig + runs + runner heartbeat). Tickets and decisions go out only when a write changed them.
// Ticket logs never ride on this poll (GET /api/log/:id). serverNow lets the page judge the heartbeat by the server clock.
export async function GET(req: Request) {
  const since = new URL(req.url).searchParams.get('since');
  return handle(async () => {
    const store = getStore();
    const sig = await store.boardSig();
    if (since && since === sig) return { unchanged: true, sig, ...(await store.readRuntime()), serverNow: Date.now() };
    return { ...(await store.readLight()), sig, serverNow: Date.now() };
  });
}
