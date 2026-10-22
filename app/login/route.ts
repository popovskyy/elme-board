// Plain HTML login so it loads before anything else of the board.
export function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') || '/board/index.html';
  const error = url.searchParams.get('error');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#E9EDE3"><title>Elme Board · Sign in</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F4EF;color:#2F2E2A;font:16px/1.4 Karla,system-ui,sans-serif;padding:24px}
form{width:min(360px,100%);display:grid;gap:14px;background:#fff;border:1px solid #DDDBD2;padding:28px 24px}
h1{margin:0;font:400 30px/1.1 "DM Serif Display",Georgia,serif}
label{font-weight:700;font-size:14px}
input{font:inherit;padding:12px;border:1px solid #DDDBD2;min-height:48px}
button{font:inherit;font-weight:700;min-height:50px;border:0;background:#55644A;color:#fff;cursor:pointer}
.err{color:#9E3F2A;font-weight:700;margin:0}
</style></head><body>
<form method="post" action="/api/login">
<h1>Elme Board</h1>
${error ? '<p class="err">Wrong password. Try again.</p>' : ''}
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">Sign in</button>
</form></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
