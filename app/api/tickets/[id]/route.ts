import { handle } from '@/lib/http';
import { getStore, NotFoundError, Ticket } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const t = await getStore().getTicket(id);
    if (!t) throw new NotFoundError(`No ticket ${id}`);
    return t;
  });
}

// Body: { patch: Partial<Ticket>, ifVersion?: number }. The page computes the patch with lib/logic.mjs.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { patch, ifVersion } = (await req.json()) as { patch: Partial<Ticket>; ifVersion?: number };
  return handle(() => getStore().patchTicket(id, { ...patch, updatedAt: patch.updatedAt ?? Date.now() }, ifVersion));
}
