import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  // serverNow lets the page judge the runner heartbeat by the server clock, not the phone's.
  return handle(async () => ({ ...(await getStore().read()), serverNow: Date.now() }));
}
