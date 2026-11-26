// The light switch on the board → the PC runner → the local dev-dashboard (HyperHDR LED strip).
// The board (Vercel) cannot reach the PC, so it stores a wish (`want`, written at `wantAt`) and the runner,
// which already polls the board over outbound HTTPS, applies it and reports what the strip really does (`actual`).
// `appliedAt` is the `wantAt` of the last wish the runner handled: a wish is open while wantAt > appliedAt.

export const emptyLights = () => ({ want: null, wantAt: 0, actual: null, actualAt: 0, appliedAt: 0, error: null });

/** What the runner has to do now: true (on), false (off), or null when the last wish is already handled. */
export function lightsTodo(l) {
  return l && typeof l.want === 'boolean' && (l.wantAt || 0) > (l.appliedAt || 0) ? l.want : null;
}

/** Board → store: the press of the button. Only `want` comes from the page. */
export function wishPatch(body, now) {
  if (typeof body?.want !== 'boolean') throw new Error('want must be true or false');
  return { want: body.want, wantAt: now, error: null };
}

/** Runner → store: what happened. Anything else in the body is ignored. */
export function reportPatch(body, now) {
  const p = { actualAt: now };
  if (typeof body?.actual === 'boolean' || body?.actual === null) p.actual = body.actual;
  if (Number.isFinite(body?.appliedAt)) p.appliedAt = Number(body.appliedAt);
  if (body && 'error' in body) p.error = body.error ? String(body.error).slice(0, 200) : null;
  return p;
}
