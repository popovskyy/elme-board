import { handle, requireToken } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

// GET /api/runner/merge → done tickets whose branch Roman asked to merge into main.
export async function GET(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  return handle(async () => ({ tickets: await getStore().mergeTickets() }));
}
