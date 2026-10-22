# Elme Board (app)

Roman's private board for the Elme Hyvä port: Next.js app for Vercel + a runner on his PC that starts Claude or Cursor on a ticket. Full brief: `../BOARD-BRIEF.md`. Spec: `../board-design.md`.

This folder is its own git repo. It lives inside `elme-hyva/.roadmap/`, which the elme-hyva repo ignores. Never commit any of it to elme-hyva.

## Run locally

```bash
cp .env.example .env          # leave DATABASE_URL empty → local JSON file store
npm install
npm run seed                  # copies ../board.json (export of the old artifact) to data/board.json
npm run dev                   # http://127.0.0.1:4400 → the board
npm test                      # status rules (lib/logic.mjs)
npm run board -- next --runner claude   # CLI against the running app
npm run runner                # PC runner (see status below)
```

## Layout

| Path | What | Status |
| --- | --- | --- |
| `public/board/index.html` | Board UI, ported unchanged from the claude.ai artifact | done |
| `public/board/db-shim.js` | `window.claude.use('db')` surface backed by this API (polling every 5 s) | done |
| `lib/logic.mjs` | Status rules, the one source; `npm run sync-logic` copies it to `public/board/logic.js` | done, tested |
| `lib/store/file.ts` | JSON file store, atomic writes, versions, 409 on conflict | done |
| `lib/store/pg.ts` + `db/schema.sql` | Postgres store for Vercel | **TODO** |
| `app/api/*` | board, tickets, log, runner/next, runner/heartbeat, runs | done (file store) |
| `cli/board.mjs` | Agent CLI: show, next, take, built, qa, block, log, assign | done |
| `runner/runner.mjs` | PC runner: heartbeat, poll, preflight, branch, spawn, stream, Stop | **skeleton** |

## Next steps (for Cursor)

1. **Postgres store.** Implement `PgStore` on `db/schema.sql` (Neon from the Vercel Marketplace), make `npm run seed` insert into it, add a store contract test that runs against both stores.
2. **Page additions** in `public/board/index.html` (brief, section 1):
   - "Run with: Claude | Cursor" in the ticket panel; it is saved as `runner` with the status change.
   - Runner badges on cards and rows.
   - "PC online / offline" in the header. The shim dispatches `board:meta` with `runnerStatus`.
   - Live run view and a Stop button (`PATCH /api/runs/:id {stopRequested:true}`).
3. **Runner TODOs:**
   - Preflight: deps done, decisions decided, UX `extends` done.
   - Prompt: add the log (bugs, answers, last QA report), the chosen decisions, and the Definition of Done for QA.
   - **Permissions.** Ask Roman: a Claude allowlist in elme-hyva `.claude/settings.local.json`, or skip-permissions flags; the cursor-agent flags too.
   - A systemd user service for the runner.
4. **Agents:**
   - Point `.claude/agents/*.md` and `.claude/commands/elme-board.md` at `cli/board.mjs`.
   - Add `.cursor/rules/elme-board.mdc` to elme-hyva (git-ignored).
5. **Deploy:**
   - Vercel project from this folder.
   - Env: `DATABASE_URL`, `BOARD_TOKEN`.
   - Deployment Protection on. Put the automation bypass secret in the PC `.env` as `VERCEL_PROTECTION_BYPASS`.
   - Set `BOARD_URL` on the PC to the deployment URL.
