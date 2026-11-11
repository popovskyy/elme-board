#!/usr/bin/env node
// Add a batch of tickets to the board from a JSON file.
//
//   npm run import-tickets -- scripts/tickets/2026-11-prod-gaps.json            # dry run: prints what it would add
//   npm run import-tickets -- scripts/tickets/2026-11-prod-gaps.json --apply    # creates the tickets
//
// Env (from .env or the shell), same as cli/board.mjs: BOARD_URL, BOARD_TOKEN, VERCEL_PROTECTION_BYPASS.
// Safe to run twice: a ticket whose title is already on the board is skipped.
// File: { note, tickets: [{ key, title, kind, epic, deps, scope, ref, qa }] }.
//   epic  - matched to a board epic by name or by its leading number ("5 PDP" finds the board's epic 5); wave comes from that epic.
//   deps  - board ids ("FE-25"; unknown ids are dropped with a warning) or "@key" of another ticket in the file.
import { readFileSync, existsSync } from 'node:fs';

loadEnv(new URL('../.env', import.meta.url));
const BASE = (process.env.BOARD_URL || 'http://127.0.0.1:4400').replace(/\/$/, '');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('Usage: import-tickets <file.json> [--apply]'); process.exit(1); }

try {
  await main();
} catch (e) {
  console.error(`import-tickets: ${e.message}`);
  process.exit(1);
}

async function main() {
  const { note, tickets } = JSON.parse(readFileSync(file, 'utf8'));
  const board = await api('/api/board');
  const existing = Object.values(board.tickets || {});
  const byTitle = new Map(existing.map((t) => [norm(t.title), t.id]));
  const ids = new Set(existing.map((t) => t.id));
  const created = new Map(); // key -> board id
  let added = 0;

  console.log(`${BASE}: ${existing.length} tickets on the board. ${apply ? 'Creating' : 'Dry run (add --apply to create)'}:\n`);
  for (const t of order(tickets)) {
    const have = byTitle.get(norm(t.title));
    if (have) { created.set(t.key, have); console.log(`  skip   ${have}  ${t.title} (already on the board)`); continue; }
    const place = placeFor(t.epic, existing);
    const deps = [];
    for (const d of t.deps || []) {
      if (d.startsWith('@')) { const id = created.get(d.slice(1)); id ? deps.push(id) : apply && console.warn(`         ${t.key}: dependency ${d} was not created`); }
      else if (ids.has(d)) deps.push(d);
      else console.warn(`         ${t.key}: dependency ${d} is not on the board, dropped`);
    }
    if (!apply) { created.set(t.key, `@${t.key}`); console.log(`  add    ${t.kind}  ${t.title}  [${place.epic}${place.wave ? `, stage ${place.wave}` : ''}]`); added++; continue; }
    const made = await api('/api/tickets', { method: 'POST', body: JSON.stringify({ title: t.title, kind: t.kind, scope: t.scope, ref: t.ref, qa: t.qa, deps, ...place }) });
    await api(`/api/log/${made.id}`, { method: 'POST', body: JSON.stringify({ entry: { at: Date.now(), who: 'roman', kind: 'log', text: note || 'Created by import-tickets.' } }) });
    created.set(t.key, made.id); ids.add(made.id); added++;
    console.log(`  added  ${made.id}  ${t.title}`);
  }
  console.log(`\n${apply ? 'Added' : 'Would add'} ${added} of ${tickets.length}.`);
}

/** Tickets that others depend on go first, so "@key" resolves to a real id. */
function order(list) {
  const out = [], seen = new Set(), byKey = new Map(list.map((t) => [t.key, t]));
  const visit = (t) => {
    if (seen.has(t.key)) return;
    seen.add(t.key);
    for (const d of t.deps || []) if (d.startsWith('@') && byKey.has(d.slice(1))) visit(byKey.get(d.slice(1)));
    out.push(t);
  };
  list.forEach(visit);
  return out;
}

/** The board epic this ticket belongs to, and the plan stage most tickets of that epic sit in. */
function placeFor(epic, existing) {
  const num = (s) => String(s || '').match(/^\s*(\d+)/)?.[1];
  const epics = [...new Set(existing.map((t) => t.epic).filter(Boolean))];
  const found = epics.find((e) => norm(e) === norm(epic)) || (num(epic) && epics.find((e) => num(e) === num(epic))) || epic;
  const count = new Map();
  for (const t of existing) if (t.epic === found && t.wave) count.set(t.wave, (count.get(t.wave) || 0) + 1);
  const wave = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const waveName = existing.find((t) => t.wave === wave)?.waveName;
  return wave ? { epic: found, wave, waveName } : { epic: found };
}

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

async function api(path, init = {}) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.BOARD_TOKEN) headers.authorization = `Bearer ${process.env.BOARD_TOKEN}`;
  if (process.env.VERCEL_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${body.error || ''}`.trim());
  return body;
}

function loadEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
