#!/usr/bin/env node
// Runner on Roman's PC: polls the board, runs Claude or Cursor one ticket at a time,
// and merges a ticket branch into main when Roman presses Done (mergeRequested).
// Outbound HTTPS only. Agents still must not merge/push/Done themselves.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

loadEnv(new URL('../.env.local', import.meta.url));
loadEnv(new URL('../.env', import.meta.url));
const BASE = (process.env.BOARD_URL || 'http://127.0.0.1:4400').replace(/\/$/, '');
const REPO = process.env.REPO_DIR || '/home/romanod/Documents/BartGroup/elme-hyva';
const ROLES = { fe: 'fe-engineer', be: 'be-engineer', qa: 'qa-engineer' };
const POLL_MS = 15_000;
const BUSY_POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;

let busy = null; // { ticketId, runId, child } | { ticketId, merging: true }

setInterval(() => api('/api/runner/heartbeat', { method: 'POST', body: { host: os.hostname(), busyWith: busy?.ticketId ?? null } }).catch(warn), HEARTBEAT_MS);
await api('/api/runner/heartbeat', { method: 'POST', body: { host: os.hostname(), busyWith: null } }).catch(warn);
console.log(`runner: polling ${BASE} every ${POLL_MS / 1000}s, repo ${REPO}`);
loop();

async function loop() {
  try {
    if (!busy) {
      // Done → merge into main first (Roman pressed Done on the phone).
      if (await mergeNext()) { /* merged one */ }
      else {
        for (const runner of ['claude', 'cursor']) {
          const { ticket } = await api(`/api/runner/next?runner=${runner}`);
          if (ticket) { await start(ticket, runner); break; }
        }
      }
    } else if (!busy.merging) {
      await checkStop();
    }
  } catch (e) { warn(e); }
  setTimeout(loop, busy ? BUSY_POLL_MS : POLL_MS);
}

async function mergeNext() {
  const board = await api('/api/board');
  const pending = Object.values(board.tickets || {})
    .filter((t) => t.status === 'done' && t.mergeRequested && t.branch && t.branch !== 'main')
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  if (!pending.length) return false;
  const t = pending[0];
  busy = { ticketId: t.id, merging: true };
  console.log(`runner: merging ${t.id} branch ${t.branch} → main`);
  try {
    if (git(['status', '--porcelain', '--untracked-files=no']).trim()) {
      throw new Error('Working tree has uncommitted changes. Commit or stash, then press Done again (or set mergeRequested).');
    }
    const hasOrigin = hasRemote('origin');
    if (hasOrigin) {
      try { git(['fetch', 'origin']); } catch { /* offline ok */ }
    }
    git(['checkout', 'main']);
    if (hasOrigin) {
      try { git(['pull', '--ff-only', 'origin', 'main']); } catch { /* diverge / offline */ }
    }
    if (!existsBranch(t.branch)) throw new Error(`Branch \`${t.branch}\` not found on the PC.`);
    const msg = `Merge ${t.id}: ${t.title}`;
    git(['merge', '--no-ff', '-m', msg, t.branch]);
    let pushed = false;
    if (hasOrigin) {
      try {
        git(['push', 'origin', 'main']);
        pushed = true;
      } catch (e) {
        warn(`merge ok locally, push failed: ${e.message || e}`);
      }
    }
    await patchTicket(t, {
      mergeRequested: false,
      mergedAt: Date.now(),
      mergeError: null,
    });
    await cli(['log', t.id, '--who', 'watcher', '--kind', 'log', '--text',
      pushed
        ? `Merged \`${t.branch}\` into \`main\` and pushed origin/main.`
        : `Merged \`${t.branch}\` into \`main\` locally. Push to origin failed — push manually if needed.`,
    ]);
    console.log(`runner: merged ${t.id}`);
  } catch (e) {
    const err = String(e.message || e).slice(0, 500);
    warn(`merge ${t.id} failed: ${err}`);
    try {
      // Leave repo on main if possible; abort merge if stuck mid-merge.
      try { git(['merge', '--abort']); } catch { /* not merging */ }
      try { git(['checkout', 'main']); } catch { /* ignore */ }
      await patchTicket(t, { mergeRequested: false, mergeError: err, mergedAt: null });
      await cli(['log', t.id, '--who', 'watcher', '--kind', 'note', '--text',
        `Merge into main failed: ${err}\n\nFix the repo, then reopen Review → Done to retry.`,
      ]);
    } catch (e2) { warn(e2); }
  } finally {
    busy = null;
  }
  return true;
}

async function start(t, runner) {
  const board = await api('/api/board');
  const problem = preflight(t, board);
  if (problem) {
    await cli(['block', t.id, '--question', problem]);
    return;
  }

  const role = t.holder;
  let branch = t.branch;
  if (role === 'fe' || role === 'be') {
    branch ||= `${t.id.toLowerCase()}-${slug(t.title)}`;
    const exists = existsBranch(branch);
    git(exists ? ['checkout', branch] : ['checkout', '-b', branch, 'main']);
  } else if (branch) {
    git(['checkout', branch]);
  } else {
    git(['checkout', 'main']);
  }
  await cli(['take', t.id, '--runner', runner, ...(role === 'qa' ? [] : ['--branch', branch])]);

  const prompt = buildPrompt(t, role, runner, branch, board);
  const extra = (runner === 'claude' ? process.env.CLAUDE_FLAGS : process.env.CURSOR_FLAGS) || '';
  const extraArgs = extra.trim() ? extra.trim().split(/\s+/) : [];
  const [cmd, args] = runner === 'claude'
    ? ['claude', ['-p', prompt, ...extraArgs]]
    : ['cursor-agent', ['-p', prompt, ...extraArgs]];
  const child = spawn(cmd, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = await api('/api/runs', { method: 'POST', body: { ticketId: t.id, runner, role, pid: child.pid } });
  busy = { ticketId: t.id, runId: run.id, child };

  const lines = [];
  const onData = (buf) => { for (const l of String(buf).split('\n')) if (l.trim()) lines.push(l); lines.splice(0, Math.max(0, lines.length - 50)); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const flush = setInterval(() => api(`/api/runs/${run.id}`, { method: 'PATCH', body: { lastLines: lines } }).catch(warn), 3000);

  child.on('exit', async (code, signal) => {
    clearInterval(flush);
    const stopped = signal === 'SIGTERM' || signal === 'SIGKILL';
    await api(`/api/runs/${run.id}`, { method: 'PATCH', body: { lastLines: lines, endedAt: Date.now(), status: stopped ? 'stopped' : code === 0 ? 'done' : 'failed' } }).catch(warn);
    const latest = await api('/api/board').catch(() => null);
    const now = latest?.tickets?.[t.id];
    if (now && now.waiting && now.holder === role) {
      const why = stopped ? 'Stopped from the board.' : `Agent ended without a report (exit ${code}).`;
      await cli(['block', t.id, '--question', `${why} Last lines:\n\n${lines.slice(-15).join('\n')}`]).catch(warn);
    }
    writeBoardMd(latest).catch(warn);
    busy = null;
  });
}

async function checkStop() {
  const board = await api('/api/board');
  if (board.runs?.[busy.runId]?.stopRequested) busy.child.kill('SIGTERM');
}

function preflight(t, board) {
  try { if (!execFileSync('docker', ['ps', '--format', '{{.Names}}']).toString().includes('elme_php')) return 'Docker stack is down. Start it?'; }
  catch { return 'Docker is not available on the PC.'; }
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) return 'The elme-hyva working tree has uncommitted changes. Commit or stash them?';
  const tickets = board?.tickets || {};
  const decisions = board?.decisions || {};
  const need = t.kind === 'UX' ? (t.extends || []) : (t.deps || []);
  const openDeps = need.filter((id) => tickets[id]?.status !== 'done');
  if (openDeps.length) return `Dependencies not done: ${openDeps.join(', ')}.`;
  const openDec = (t.decisions || []).filter((id) => decisions[id]?.status !== 'decided');
  if (openDec.length) return `Open decisions: ${openDec.join(', ')}. Answer them first?`;
  return null;
}

function buildPrompt(t, role, runner, branch, board) {
  const rolePath = `${REPO}/.claude/agents/${ROLES[role]}.md`;
  const roleFile = existsSync(rolePath) ? readFileSync(rolePath, 'utf8') : `You are the ${role} engineer for Elme.`;
  const log = board?.log?.[t.id]?.entries || [];
  const recent = log.slice(-12).map((e) => `- [${e.kind}] ${e.who}: ${e.text}`).join('\n') || '(empty)';
  const chosen = (t.decisions || []).map((id) => {
    const d = board?.decisions?.[id];
    return d ? `- ${id}: ${d.status === 'decided' ? d.chosen : 'OPEN'}` : `- ${id}`;
  }).join('\n') || '(none)';
  return [
    roleFile,
    `\n\n# Ticket ${t.id}: ${t.title}`,
    `Branch: ${branch || 'main'}. Runner: ${runner}. Role: ${role}.`,
    `\nScope:\n${t.scope}\n\nRef:\n${t.ref}`,
    `\nDecisions:\n${chosen}`,
    `\nQA items (numbered from 0):\n${(t.qa || []).map((q, i) => `${i}. ${q}`).join('\n')}`,
    `\nRecent log:\n${recent}`,
    `\n\n# Reporting\nReport through the board CLI, then stop:\n` +
      (role === 'qa'
        ? `node .roadmap/app/cli/board.mjs qa ${t.id} --verdict passed|failed --checks '<json>' --report <file>`
        : `node .roadmap/app/cli/board.mjs built ${t.id} --commits "<shas>" --summary <file>`) +
      `\nIf blocked: node .roadmap/app/cli/board.mjs block ${t.id} --question "<one question for Roman>"` +
      `\nDo not merge, push, or mark Done — Roman presses Done on the board; the PC runner merges then.`,
  ].join('\n');
}

async function patchTicket(t, patch) {
  return api(`/api/tickets/${t.id}`, {
    method: 'PATCH',
    body: { patch: { ...patch, updatedAt: Date.now() }, ifVersion: t.version ?? 1 },
  });
}

async function writeBoardMd(board) {
  if (!board?.tickets) return;
  const lines = ['# Elme board (local mirror)', '', `Updated: ${new Date().toISOString()}`, ''];
  for (const t of Object.values(board.tickets).sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999))) {
    lines.push(`- ${t.id} [${t.status}/${t.holder || '-'}] ${t.title}`);
  }
  writeFileSync(path.join(REPO, '.roadmap/board.md'), lines.join('\n') + '\n');
}

function cli(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [new URL('../cli/board.mjs', import.meta.url).pathname, ...args], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`board ${args[0]} exited ${c}`))));
  });
}
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.BOARD_TOKEN) headers.authorization = `Bearer ${process.env.BOARD_TOKEN}`;
  if (process.env.VERCEL_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.error || ''}`);
  return data;
}
function git(args) { return execFileSync('git', args, { cwd: REPO }).toString(); }
function existsBranch(b) { try { git(['rev-parse', '--verify', '--quiet', b]); return true; } catch { return false; } }
function hasRemote(name) {
  try { return git(['remote']).split('\n').map((s) => s.trim()).includes(name); }
  catch { return false; }
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, 4).join('-'); }
function warn(e) { console.warn(`runner: ${e.message || e}`); }
function loadEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
