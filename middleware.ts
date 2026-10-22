import { NextRequest, NextResponse } from 'next/server';
import { boardSecret, COOKIE, sameString, sessionValue } from './lib/session';

// Everything except the login screen and the app icons needs Roman's session cookie or the machine token.
// Without this, anyone with the URL could change tickets, and the agents on the PC act on ticket text.
const PUBLIC = [/^\/login$/, /^\/api\/login$/, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/favicon\.png$/, /^\/apple-touch-icon\.png$/];

export async function middleware(req: NextRequest) {
  const secret = boardSecret();
  if (!secret) return NextResponse.next(); // local dev without secrets
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const token = process.env.BOARD_TOKEN;
  const auth = req.headers.get('authorization') || '';
  if (token && sameString(auth, `Bearer ${token}`)) return NextResponse.next();

  const cookie = req.cookies.get(COOKIE)?.value || '';
  if (cookie && sameString(cookie, await sessionValue(secret))) return NextResponse.next();

  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, `${proto}://${host}`));
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
