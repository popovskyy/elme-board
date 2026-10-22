import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => getStore().read());
}
