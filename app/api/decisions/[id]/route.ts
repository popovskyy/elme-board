import { handle } from '@/lib/http';
import { Decision, getStore } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

// Body: { patch: Partial<Decision>, ifVersion?: number }.
// Roman decides from the Decisions tab (or CLI `board decide D3 --chosen "…"`).
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { patch, ifVersion } = (await req.json()) as { patch: Partial<Decision>; ifVersion?: number };
  return handle(() => getStore().patchDecision(id, patch, ifVersion));
}
