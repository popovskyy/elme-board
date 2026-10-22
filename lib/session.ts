// One-person login for the board. The secret is BOARD_PASSWORD (set it in Vercel), else BOARD_TOKEN.
// The cookie holds a hash of the secret, so changing the secret logs every device out.
export const COOKIE = 'elme_board';

export function boardSecret(): string | null {
  return process.env.BOARD_PASSWORD || process.env.BOARD_TOKEN || null;
}

export async function sessionValue(secret: string): Promise<string> {
  const data = new TextEncoder().encode(`elme-board:v1:${secret}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
