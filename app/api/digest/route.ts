import { handle } from '@/lib/http';
import { getStore, Ticket } from '@/lib/store';
import { buildDigest, dateIn, dayRange, shiftDate, DIGEST_TZ } from '@/lib/digest.mjs';

export const dynamic = 'force-dynamic';

// GET /api/digest?date=YYYY-MM-DD: the daily update for one Kyiv calendar day, as copy-ready text in English
// and Ukrainian. Without a date: yesterday. Computed from the ticket logs on each call, so it is always current.
export async function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get('date');
  return handle(async () => {
    const today = dateIn(DIGEST_TZ, Date.now());
    const date = asked || shiftDate(today, -1);
    const { from, to } = dayRange(date);
    if (date > today) throw new Error('That day has not happened yet');
    const store = getStore();
    const logs = await store.logsBetween(from, to);
    const tickets: Record<string, Ticket> = {};
    await Promise.all(Object.keys(logs).map(async (id) => { const t = await store.getTicket(id); if (t && !t.archived) tickets[id] = t; }));
    return buildDigest(tickets, logs, date, today);
  });
}
