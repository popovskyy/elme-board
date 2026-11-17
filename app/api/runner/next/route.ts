import { handle, requireToken } from '@/lib/http';
import { getStore, Runner } from '@/lib/store';
import { ENABLED_RUNNERS, pickable } from '@/lib/logic.mjs';

export const dynamic = 'force-dynamic';

// GET /api/runner/next?runner=claude|cursor → the oldest ticket waiting for an agent on that runner, or null.
// Only tools in ENABLED_RUNNERS (lib/logic.mjs) answer; tickets saved for a tool that is off come with the first one.
// Reads only waiting tickets: the runner calls this every 15 s.
export async function GET(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  const runner = (new URL(req.url).searchParams.get('runner') || 'claude') as Runner;
  return handle(async () => {
    if (!ENABLED_RUNNERS.includes(runner)) return { ticket: null };
    const store = getStore();
    const waiting = await store.waitingTickets(runner);
    // A ticket saved for a tool that is switched off runs with the first enabled one.
    if (runner === ENABLED_RUNNERS[0]) {
      for (const off of (['claude', 'cursor'] as Runner[]).filter((r) => !ENABLED_RUNNERS.includes(r))) waiting.push(...(await store.waitingTickets(off)));
    }
    return { ticket: pickable(waiting) };
  });
}
