#!/usr/bin/env node
// Board CLI for agents (Claude and Cursor) and the runner. Talks to the board API.
// Env (from .env or the shell): BOARD_URL, BOARD_TOKEN, VERCEL_PROTECTION_BYPASS.
//
//   board show FE-02
//   board next --runner cursor
//   board take FE-02 --branch fe-02-ui-kit --runner cursor
//   board built FE-02 --commits "a1b2c3 d4e5f6" --summary summary.md
//   board qa FE-02 --verdict passed --checks '[{"i":0,"state":"passed"}]' --report report.md
//   board block FE-02 --question "Which menu source, D3?"
//   board log FE-02 --who fe --kind note --text "…"
import { readFileSync, existsSync } from 'node:fs';
import { assign, block, handToQa, qaPassed, qaFailed, ideasDone, ideasRestore, seoDone } from '../lib/logic.mjs';

loadEnv(new URL('../.env', import.meta.url));
const BASE = (process.env.BOARD_URL || 'http://127.0.0.1:4400').replace(/\/$/, '');

const argv = process.argv.slice(2);
const cmd = argv[0];
const id = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

try {
  await main();
} catch (e) {
  console.error(`board: ${e.message}`);
  process.exit(1);
}

async function main() {
  switch (cmd) {
    case 'show': return print(await ticket(id));
    case 'next': {
      const runner = need(opt('runner') ?? id, '--runner claude|cursor');
      const r = await api(`/api/runner/next?runner=${runner}`);
      return print(r.ticket ?? 'none');
    }
    case 'take': {
      const t = await ticket(id);
      const runner = need(opt('runner'), '--runner');
      if ((t.runner ?? 'claude') !== runner) throw new Error(`${id} is assigned to ${t.runner ?? 'claude'}, not ${runner}`);
      if (!t.waiting) throw new Error(`${id} is not waiting for an agent`);
      const patch = {};
      if (t.holder === 'fe' || t.holder === 'be') { patch.branch = need(opt('branch'), '--branch'); patch.builder = t.holder; }
      await patchTicket(t, patch);
      return appendLog(id, { who: t.holder, kind: 'log', text: `Picked up by ${runner}${patch.branch ? `, branch \`${patch.branch}\`` : ''}.` });
    }
    case 'built': {
      const t = await ticket(id);
      if (t.status !== 'in_progress') throw new Error(`${id} is ${t.status}, not in_progress`);
      const summary = file(opt('summary'));
      // Log first: if the status write fails, the report is still on the board.
      await appendLog(id, { who: t.holder, kind: 'log', text: `Done, handed to QA. Commits: ${opt('commits') || '—'}\n\n${summary}` });
      return patchTicket(t, handToQa(t));
    }
    case 'qa': {
      const t = await ticket(id);
      if (t.status !== 'in_qa') throw new Error(`${id} is ${t.status}, not in_qa`);
      const verdict = need(opt('verdict'), '--verdict passed|failed');
      const at = Date.now();
      const qaChecks = [...(t.qaChecks || [])];
      for (const c of JSON.parse(opt('checks') || '[]')) qaChecks[c.i] = { state: c.state, by: 'qa', at };
      let patch;
      if (verdict === 'passed') patch = qaPassed(t);
      else if (t.kind === 'UX' || !t.builder) patch = { ...qaPassed(t), qaVerdict: 'failed' };
      else patch = qaFailed(t, t.builder);
      await appendLog(id, { who: 'qa', kind: 'qa_report', text: file(opt('report')) });
      return patchTicket(t, { ...patch, qaChecks });
    }
    case 'ideas': {
      const t = await ticket(id);
      const verdict = need(opt('verdict'), '--verdict ship|push');
      await patchTicket(t, ideasDone(t, verdict));
      return appendLog(id, { who: 'idea', kind: 'ideas', text: `Verdict: ${verdict}\n\n${file(opt('report'))}` });
    }
    case 'seo': {
      const t = await ticket(id);
      if (t.holder !== 'seo') throw new Error(`${id} is not with the SEO agent`);
      await appendLog(id, { who: 'seo', kind: 'seo', text: file(opt('report')) });
      return patchTicket(t, seoDone(t));
    }
    case 'ideas-restore': {
      const t = await ticket(id);
      await patchTicket(t, ideasRestore(t));
      return appendLog(id, { who: 'watcher', kind: 'note', text: opt('text') || 'Marketing review stopped before a verdict.' });
    }
    case 'block': {
      const t = await ticket(id);
      await patchTicket(t, block(t));
      return appendLog(id, { who: t.holder || 'watcher', kind: 'question', text: need(opt('question'), '--question') });
    }
    case 'assign': { // for scripts/tests; Roman normally does this on the board
      const t = await ticket(id);
      await patchTicket(t, { ...assign(t, need(opt('to'), '--to fe|be|qa')), runner: opt('runner') ?? t.runner ?? 'claude' });
      return;
    }
    case 'log':
      return appendLog(id, { who: opt('who') || 'watcher', kind: opt('kind') || 'note', text: need(opt('text'), '--text') });
    default:
      console.log('Usage: board show|next|take|built|qa|ideas|ideas-restore|seo|block|log|assign <ID> [options] (see header of cli/board.mjs)');
      process.exit(cmd ? 1 : 0);
  }
}

async function api(path, init = {}) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.BOARD_TOKEN) headers.authorization = `Bearer ${process.env.BOARD_TOKEN}`;
  if (process.env.VERCEL_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${body.error || ''}`.trim());
  return body;
}
async function ticket(tid) {
  need(tid, 'ticket id');
  const board = await api('/api/board');
  const t = board.tickets[tid];
  if (!t) throw new Error(`No ticket ${tid}`);
  return t;
}
function patchTicket(t, patch) {
  return api(`/api/tickets/${t.id}`, { method: 'PATCH', body: JSON.stringify({ patch, ifVersion: t.version ?? 1 }) });
}
async function appendLog(tid, entry) {
  await api(`/api/log/${tid}`, { method: 'POST', body: JSON.stringify({ entry: { at: Date.now(), ...entry } }) });
}
function need(v, what) { if (!v) throw new Error(`missing ${what}`); return v; }
function file(p) { return p ? readFileSync(p, 'utf8') : ''; }
function print(v) { console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2)); }
function loadEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
