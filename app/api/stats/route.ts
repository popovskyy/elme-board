import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

const DAYS = 90;

// GET /api/stats: run history for the Insights tab, without output lines. Asked for only when that tab opens.
export async function GET() {
  return handle(async () => ({ days: DAYS, runs: await getStore().runStats(Date.now() - DAYS * 24 * 60 * 60 * 1000), serverNow: Date.now() }));
}
