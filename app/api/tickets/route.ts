import { handle } from '@/lib/http';
import { getStore, NewTicket } from '@/lib/store';

const KINDS = ['FE', 'BE', 'UX'];

// POST /api/tickets: Roman adds a ticket from the board.
export async function POST(req: Request) {
  const input = (await req.json()) as NewTicket;
  return handle(async () => {
    if (!input.title?.trim()) throw new Error('Title is required');
    if (!KINDS.includes(input.kind)) throw new Error('Kind must be FE, BE or UX');
    return getStore().createTicket({
      ...input,
      qa: (input.qa || []).map((q) => String(q).trim()).filter(Boolean),
      deps: (input.deps || []).filter(Boolean),
    });
  });
}
