import { handle, requireToken } from '@/lib/http';
import { getStore } from '@/lib/store';

export async function POST(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  const { host, busyWith } = (await req.json()) as { host: string; busyWith: string | null };
  return handle(async () => {
    await getStore().heartbeat({ lastSeenAt: Date.now(), host, busyWith: busyWith ?? null });
    return { ok: true };
  });
}
