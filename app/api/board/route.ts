import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Light read: no ticket_log blobs (those are on /api/log/:id). Cuts Neon transfer on the 5s poll.
  // serverNow lets the page judge the runner heartbeat by the server clock, not the phone's.
  return handle(async () => ({ ...(await getStore().readLight()), serverNow: Date.now() }));
}
