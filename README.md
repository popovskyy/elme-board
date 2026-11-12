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

| Path | What |
| --- | --- |
| `public/board/index.html` | Board UI |
| `public/board/db-shim.js` | `window.claude.use('db')` surface backed by this API |
| `lib/logic.mjs` | Status rules, the one source; `npm run sync-logic` copies it to `public/board/logic.js` |
| `lib/store/file.ts`, `lib/store/pg.ts` + `db/schema.sql` | JSON file store (local) and Postgres store (Vercel, Neon) |
| `app/api/*` | board, tickets, log, decisions, runner/next, runner/merge, runner/heartbeat, runs |
| `lib/digest.mjs` + `app/api/digest` | Daily update (the Update button): what moved on one Kyiv day, as copy-ready text in Ukrainian and English, built from the ticket logs |
| `cli/board.mjs` | Agent CLI: show, next, take, built, qa, seo, ideas, block, decide, log, assign |
| `runner/runner.mjs` | PC runner (user service `elme-board-runner`): heartbeat, poll, preflight, branch, spawn, stream, Stop, checkpoint, handoff, merge on Done |
| `runner/prompt.mjs` | What goes from the ticket log into an agent prompt; usage-limit detection (tested) |

After a change in `runner/`: `npm test`, then `systemctl --user restart elme-board-runner` while no ticket is running.
