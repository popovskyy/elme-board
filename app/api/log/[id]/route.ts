import { handle } from '@/lib/http';
import { ConflictError, getStore, LogEntry } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const d = await getStore().getLog(id);
    return d ? { ...d, version: d.version ?? 1 } : { entries: [], version: 0 };
  });
}

// Body: { entry: LogEntry } — append one entry. Re-reads on a version clash, so the page, the CLI and the
// runner can log at the same moment without dropping each other's entries.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { entry } = (await req.json()) as { entry: LogEntry };
  return handle(async () => {
    const store = getStore();
    for (let attempt = 0; ; attempt++) {
      const cur = await store.getLog(id);
      const version = cur ? cur.version ?? 1 : 0;
      try {
        return await store.setLog(id, { entries: [...(cur?.entries || []), { ...entry, at: entry.at || Date.now() }] }, version);
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt >= 4) throw e;
      }
    }
  });
}

// Body: { entries: LogEntry[], ifVersion?: number } — the whole list (kept for old clients).
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { entries, ifVersion } = (await req.json()) as { entries: LogEntry[]; ifVersion?: number };
  return handle(() => getStore().setLog(id, { entries }, ifVersion));
}
