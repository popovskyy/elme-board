import { NextResponse } from 'next/server';
import { ConflictError, NotFoundError } from './store';

// Machine calls (runner, CLI) send `Authorization: Bearer <BOARD_TOKEN>`.
// Browser calls are protected by Vercel Deployment Protection (or the login Cursor adds).
// Local dev without BOARD_TOKEN set: everything is allowed.
export function requireToken(req: Request): NextResponse | null {
  const token = process.env.BOARD_TOKEN;
  if (!token) return null;
  return req.headers.get('authorization') === `Bearer ${token}`
    ? null
    : NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof ConflictError) return NextResponse.json({ error: 'conflict', current: e.current }, { status: 409 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: (e as Error).message || 'error' }, { status: 400 });
  }
}
