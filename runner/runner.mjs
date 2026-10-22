#!/usr/bin/env node
// Runner on Roman's PC: asks the board for work, runs Claude or Cursor on one ticket at a time,
// streams output to the board. Outbound HTTPS only; the PC accepts no connections.
//
// STATUS: skeleton. Working: heartbeat, polling, preflight, branch, spawn (argument array, no shell),
// output streaming, Stop. TODO(Cursor): see README "Next steps" (permissions, prompts, reports, service).
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';

loadEnv(new URL('../.env', import.meta.url));
const BASE = (process.env.BOARD_URL || 'http://127.0.0.1:4400').replace(/\/$/, '');
const REPO = process.env.REPO_DIR || '/home/romanod/Documents/BartGroup/elme-hyva';
const ROLES = { fe: 'fe-engineer', be: 'be-engineer', qa: 'qa-engineer' };
const POLL_MS = 15_000;
const HEARTBEAT_MS = 30_000;

let busy = null; // { ticketId, runId, child }

setInterval(() => api('/api/runner/heartbeat', { method: 'POST', body: { host: os.hostname(), busyWith: busy?.ticketId ?? null } }).catch(warn), HEARTBEAT_MS);
await api('/api/runner/heartbeat', { method: 'POST', body: { host: os.hostname(), busyWith: null } }).catch(warn);
console.log(`runner: polling ${BASE} every ${POLL_MS / 1000}s, repo ${REPO}`);
loop();

async function loop() {
  try {
    if (!busy) {
      for (const runner of ['claude', 'cursor']) {
        const { ticket } = await api(`/api/runner/next?runner=${runner}`);
        if (ticket) { await start(ticket, runner); break; }
      }
    } else {
      await checkStop();
    }
  } catch (e) { warn(e); }
  setTimeout(loop, POLL_MS);
}

async function start(t, runner) {
  const problem = preflight(t);
  if (problem) return cli(['block', t.id, '--question', problem]);

  const role = t.holder;
  let branch = t.branch;
  if (role === 'fe' || role === 'be') {
    branch ||= `${t.id.toLowerCase()}-${slug(t.title)}`;
    git(['checkout', existsBranch(branch) ? branch : '-b', ...(existsBranch(branch) ? [] : [branch, 'main'])]);
  } else if (branch) {
    git(['checkout', branch]);
  } else {
    git(['checkout', 'main']); // UX ticket QA runs on main
  }
  await cli(['take', t.id, '--runner', runner, ...(role === 'qa' ? [] : ['--branch', branch])]);

  const prompt = buildPrompt(t, role, runner, branch);
  // TODO(Cursor): confirm flags with Roman (permissions). No shell: arguments are passed as an array.
  const [cmd, args] = runner === 'claude'
    ? ['claude', ['-p', prompt]]
    : ['cursor-agent', ['-p', prompt]];
  const child = spawn(cmd, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = await api('/api/runs', { method: 'POST', body: { ticketId: t.id, runner, role, pid: child.pid } });
  busy = { ticketId: t.id, runId: run.id, child };

  const lines = [];
  const onData = (buf) => { for (const l of String(buf).split('\n')) if (l.trim()) lines.push(l); lines.splice(0, Math.max(0, lines.length - 50)); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const flush = setInterval(() => api(`/api/runs/${run.id}`, { method: 'PATCH', body: { lastLines: lines } }).catch(warn), 5000);

  child.on('exit', async (code, signal) => {
    clearInterval(flush);
    const stopped = signal === 'SIGTERM' || signal === 'SIGKILL';
    await api(`/api/runs/${run.id}`, { method: 'PATCH', body: { lastLines: lines, endedAt: Date.now(), status: stopped ? 'stopped' : code === 0 ? 'done' : 'failed' } }).catch(warn);
    // If the agent did not report through the CLI, the ticket is still waiting with the same holder.
    const board = await api('/api/board').catch(() => null);
    const now = board?.tickets?.[t.id];
    if (now && now.waiting && now.holder === role) {
      const why = stopped ? 'Stopped from the board.' : `Agent ended without a report (exit ${code}).`;
      await cli(['block', t.id, '--question', `${why} Last lines:\n\n${lines.slice(-15).join('\n')}`]).catch(warn);
    }
    busy = null;
  });
}

async function checkStop() {
  const board = await api('/api/board');
  if (board.runs?.[busy.runId]?.stopRequested) busy.child.kill('SIGTERM');
}

function preflight(t) {
  try { if (!execFileSync('docker', ['ps', '--format', '{{.Names}}']).toString().includes('elme_php')) return 'Docker stack is down. Start it?'; }
  catch { return 'Docker is not available on the PC.'; }
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) return 'The elme-hyva working tree has uncommitted changes. Commit or stash them?';
  // TODO(Cursor): deps done, decisions decided (read from /api/board), UX extends done.
  return null;
}

function buildPrompt(t, role, runner, branch) {
  const roleFile = readFileSync(`${REPO}/.claude/agents/${ROLES[role]}.md`, 'utf8');
  // TODO(Cursor): include log entries (bugs, answers, last QA report), chosen decisions, DoD for QA.
  return [
    roleFile,
    `\n\n# Ticket ${t.id}: ${t.title}`,
    `Branch: ${branch || 'main'}. Runner: ${runner}.`,
    `\nScope:\n${t.scope}\n\nRef:\n${t.ref}`,
    `\nQA items (numbered from 0):\n${(t.qa || []).map((q, i) => `${i}. ${q}`).join('\n')}`,
    `\n\n# Reporting\nReport through the board CLI, then stop:\n` +
      (role === 'qa'
        ? `node .roadmap/app/cli/board.mjs qa ${t.id} --verdict passed|failed --checks '<json>' --report <file>`
        : `node .roadmap/app/cli/board.mjs built ${t.id} --commits "<shas>" --summary <file>`) +
      `\nIf blocked: node .roadmap/app/cli/board.mjs block ${t.id} --question "<one question for Roman>"`,
  ].join('\n');
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
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, 4).join('-'); }
function warn(e) { console.warn(`runner: ${e.message || e}`); }
function loadEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
