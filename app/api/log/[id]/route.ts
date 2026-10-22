import { handle } from '@/lib/http';
import { getStore, LogEntry } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const d = await getStore().getLog(id);
    return d ? { ...d, version: d.version ?? 1 } : { entries: [], version: 0 };
  });
}

// Body: { entries: LogEntry[], ifVersion?: number } — the whole list, as the page writes it.
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { entries, ifVersion } = (await req.json()) as { entries: LogEntry[]; ifVersion?: number };
  return handle(() => getStore().setLog(id, { entries }, ifVersion));
}
