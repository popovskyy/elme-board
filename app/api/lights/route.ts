import { handle, requireToken } from '@/lib/http';
import { getStore } from '@/lib/store';
import { reportPatch, wishPatch } from '@/lib/lights.mjs';

export const dynamic = 'force-dynamic';

// The light switch (HyperHDR strip on Roman's PC). The board cannot reach the PC, so:
//   POST  {want: true|false}                      page → stores the wish
//   GET                                           runner → reads the wish (and the page, for its own state)
//   PATCH {actual, appliedAt, error}              runner → reports what the strip really does (machine token)
export async function GET() {
  return handle(async () => ({ lights: await getStore().getLights(), serverNow: Date.now() }));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => ({ lights: await getStore().patchLights(wishPatch(body, Date.now())) }));
}

export async function PATCH(req: Request) {
  const denied = requireToken(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  return handle(async () => ({ lights: await getStore().patchLights(reportPatch(body, Date.now())) }));
}
