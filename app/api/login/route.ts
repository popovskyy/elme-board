import { NextResponse } from 'next/server';
import { boardSecret, COOKIE, sameString, sessionValue } from '@/lib/session';

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get('password') || '');
  const nextRaw = String(form.get('next') || '/board/index.html');
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/board/index.html';
  const secret = boardSecret();
  // Redirect on the host the browser used (behind Vercel or on 127.0.0.1), so the cookie lands on the same host.
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  const base = new URL(`${proto}://${host}`);
  if (!secret || !sameString(password, secret)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, base), 303);
  }
  const res = NextResponse.redirect(new URL(next, base), 303);
  res.cookies.set(COOKIE, await sessionValue(secret), {
    httpOnly: true, secure: base.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
