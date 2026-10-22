import { handle, requireToken } from '@/lib/http';
import { getStore, Run } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

// Runner: status, lastLines, endedAt. Page: { stopRequested: true } (Stop button).
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const patch = (await req.json()) as Partial<Run>;
  const onlyStop = Object.keys(patch).length === 1 && patch.stopRequested === true;
  if (!onlyStop) {
    const denied = requireToken(req);
    if (denied) return denied;
  }
  return handle(() => getStore().patchRun(id, patch));
}
