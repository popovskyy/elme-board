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
const ROLES = { fe: 'fe-engineer', be: 'be-engineer', qa: 'qa-engineer', idea: 'idea-designer', seo: 'seo-engineer' };
const POLL_MS = 15_000;
const BUSY_POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const MAX_RUN_MS = Number(process.env.MAX_RUN_MINUTES || 90) * 60_000;
// Headless Claude cannot ask for approval. Without CLAUDE_FLAGS it gets this allowlist instead of skipping all checks.
const CLAUDE_DEFAULT_FLAGS = [
  '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'Task', 'TodoWrite',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git show:*)', 'Bash(git branch:*)', 'Bash(git rev-parse:*)',
  'Bash(docker ps:*)', 'Bash(docker exec:*)', 'Bash(bin/clinotty:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(python3:*)', 'Bash(bash .claude/skills/*)',
  'Bash(curl:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(find:*)', 'Bash(sed -n:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(mkdir:*)',
  '--disallowedTools', 'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git checkout:*)', 'Bash(git reset:*)', 'Bash(rm -rf:*)',
];

let busy = null; // { ticketId, runId, child } | { ticketId, merging: true }
let shuttingDown = false;

// systemd stop / PC shutdown: end the agent, mark the run stopped, leave the ticket waiting so it restarts after boot.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    shuttingDown = true;
    if (busy?.child) {
      killTree(busy.child);
      await api(`/api/runs/${busy.runId}`, { method: 'PATCH', body: { status: 'stopped', endedAt: Date.now(), lastLines: ['Runner stopped (PC shutdown or service restart). The ticket stays queued and restarts when the runner is back.'] } }).catch(warn);
    }
    process.exit(0);
  });
}

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
  try {
    await startInner(t, runner);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 600);
    warn(`start ${t.id} failed: ${msg}`);
    if (busy?.ticketId === t.id && busy.child) return; // agent is running; its exit handler reports
    try { git(['merge', '--abort']); } catch { /* not merging */ }
    await cli(['block', t.id, '--who', 'watcher', '--code', 'error', '--question', `The PC runner could not start this ticket:\n\n\`${msg}\``]).catch(warn);
  }
}

async function startInner(t, runner) {
  const board = await api('/api/board');
  const problem = preflight(t, board);
  if (problem) {
    await cli(['block', t.id, '--who', 'watcher', '--code', problem.code, '--question', problem.text]);
    return;
  }

  const role = t.holder;
  let branch = t.branch;
  let conflicts = [];
  if (role === 'fe' || role === 'be') {
    branch ||= `${t.id.toLowerCase()}-${slug(t.title)}`;
    if (t.resetBranch && existsBranch(branch)) {
      // Roman chose "Start over from main": keep the old work under another name, cut a fresh branch.
      const keep = `${branch}-old-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
      git(['checkout', 'main']);
      git(['branch', '-m', branch, keep]);
      await cli(['log', t.id, '--who', 'watcher', '--kind', 'log', '--text', `Started over from \`main\`. The previous work is kept in branch \`${keep}\`.`]).catch(warn);
    }
    const exists = existsBranch(branch);
    git(exists ? ['checkout', branch] : ['checkout', '-b', branch, 'main']);
    // Keep the ticket branch on top of main (dependencies merged after the branch was cut, e.g. FE-01 under FE-02).
    if (exists && !isAncestor('main', branch)) {
      try { git(['merge', '--no-edit', '-m', `Merge main into ${branch}`, 'main']); }
      catch {
        conflicts = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
        if (!t.resolveConflict) {
          try { git(['merge', '--abort']); } catch { /* not merging */ }
          await cli(['block', t.id, '--who', 'watcher', '--code', 'conflict', '--question',
            `\`main\` conflicts with \`${branch}\` in: ${conflicts.map((f) => `\`${f}\``).join(', ') || 'several files'}.\n\n` +
            'Choose on this ticket: **Start over from main** (the old branch is kept under a new name) or **Agent resolves the conflict**.']);
          return;
        }
        // Roman chose "Agent resolves the conflict": leave the merge open for the agent.
      }
    }
    if (t.resetBranch || t.resolveConflict) {
      await api(`/api/tickets/${t.id}`, { method: 'PATCH', body: { patch: { resetBranch: false, resolveConflict: false } } }).catch(warn);
    }
  } else if (branch) {
    git(['checkout', branch]);
  } else {
    git(['checkout', 'main']);
  }
  const branchArgs = (role === 'fe' || role === 'be') && branch ? ['--branch', branch] : [];
  await cli(['take', t.id, '--runner', runner, ...branchArgs]);
  if (t.stashFirst || t.skipChecks) {
    await api(`/api/tickets/${t.id}`, { method: 'PATCH', body: { patch: { stashFirst: false, skipChecks: false } } }).catch(warn);
  }

  let prompt = buildPrompt(t, role, runner, branch, board);
  if (conflicts.length) {
    prompt += `\n\n# Merge in progress (do this first)\nThe runner merged \`main\` into \`${branch}\` and these files conflict: ${conflicts.join(', ')}.\n` +
      'Resolve them: keep main\'s version for anything outside this ticket, keep this ticket\'s work where it is the ticket\'s scope. ' +
      'Then `git add` the files and `git commit --no-edit` to finish the merge. This is the one merge you may complete; then do the ticket.';
  }
  const extra = (runner === 'claude' ? process.env.CLAUDE_FLAGS : process.env.CURSOR_FLAGS) || '';
  const extraArgs = extra.trim() ? extra.trim().split(/\s+/).filter(Boolean) : (runner === 'claude' ? CLAUDE_DEFAULT_FLAGS : []);
  // Claude: prompt on stdin (a role file starts with `---`, which the CLI would read as an option),
  //   stream-json so the board shows what the agent is doing while it works.
  // Cursor: `cursor-agent -p --force --trust -- <prompt>` (prompt positional after `--` for the same reason).
  const [cmd, args] = runner === 'claude'
    ? ['claude', ['-p', '--output-format', 'stream-json', '--verbose', ...extraArgs]]
    : ['cursor-agent', ['-p', '--force', '--trust', '--workspace', REPO, ...extraArgs, '--', prompt]];
  const model = modelOf(extraArgs) || (runner === 'cursor' ? 'Auto' : 'Claude Code default');
  console.log(`runner: spawning ${cmd} for ${t.id} (${runner}, ${model})`);
  // Record the run before the agent starts: if the board is unreachable, no agent runs untracked.
  const run = await api('/api/runs', { method: 'POST', body: { ticketId: t.id, runner, role, branch: branch || null, model } });
  const child = spawn(cmd, args, { cwd: REPO, stdio: [runner === 'claude' ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: true });
  // Listeners go on before any await: a fast exit (bad flag, auth) must not be missed, or the runner stays busy forever.
  busy = { ticketId: t.id, runId: run.id, child };
  const lines = [];
  const push = (l) => { if (l.trim()) lines.push(l.slice(0, 400)); lines.splice(0, Math.max(0, lines.length - 50)); };
  let partial = '';
  const onOut = (buf) => {
    if (runner !== 'claude') { String(buf).split('\n').forEach(push); return; }
    const chunk = partial + String(buf);
    const parts = chunk.split('\n');
    partial = parts.pop();
    for (const p of parts) for (const l of claudeEvent(p)) push(l);
  };
  child.stdout.on('data', onOut);
  child.stderr.on('data', (buf) => String(buf).split('\n').forEach(push));
  child.on('error', (e) => { push(`spawn ${cmd}: ${e.message}`); warn(`spawn ${cmd}: ${e.message}`); });
  if (runner === 'claude') { child.stdin.on('error', () => {}); child.stdin.end(prompt); }
  const deadline = setTimeout(() => { busy && (busy.timedOut = true); killTree(child); }, MAX_RUN_MS);
  // Only ship the tail — full agent transcripts in every PATCH ate Neon transfer.
  const flush = setInterval(() => api(`/api/runs/${run.id}`, { method: 'PATCH', body: { lastLines: lines.slice(-40) } }).catch(warn), 5000);
  api(`/api/runs/${run.id}`, { method: 'PATCH', body: { pid: child.pid } }).catch(warn);
  cli(['log', t.id, '--who', 'watcher', '--kind', 'log', '--text',
    `PC started \`${cmd}\` as the ${ROLES[role]} on branch \`${branch || 'main'}\`, model ${model}.`]).catch(warn);

  child.on('exit', async (code, signal) => {
    clearInterval(flush);
    clearTimeout(deadline);
    if (partial) for (const l of claudeEvent(partial)) push(l);
    if (shuttingDown) return;
    const timedOut = !!busy?.timedOut;
    const stopped = signal === 'SIGTERM' || signal === 'SIGKILL';
    await api(`/api/runs/${run.id}`, { method: 'PATCH', body: { lastLines: lines, endedAt: Date.now(), exitCode: code, status: stopped ? 'stopped' : code === 0 ? 'done' : 'failed' } }).catch(warn);
    const latest = await api('/api/board').catch(() => null);
    const now = latest?.tickets?.[t.id];
    if (now && now.waiting && now.holder === role) {
      const why = timedOut ? `Agent ran longer than ${MAX_RUN_MS / 60_000} min and was stopped.`
        : stopped ? 'Stopped from the board.' : `Agent ended without a report (exit ${code}).`;
      const tail = lines.slice(-15).join('\n');
      if (role === 'seo') {
        // No plan is not a reason to stop the build: note it and hand the ticket on.
        await cli(['log', t.id, '--who', 'watcher', '--kind', 'note', '--text', `SEO agent gave no plan. ${why}`]).catch(warn);
        await cli(['seo', t.id, '--report', '/dev/null']).catch(warn);
      }
      else if (role === 'idea') await cli(['ideas-restore', t.id, '--text', `${why}\n\n${tail}`]).catch(warn);
      else {
        const limit = /usage limit|rate limit|quota|out of credits|upgrade to/i.test(tail);
        const code = timedOut ? 'timeout' : stopped ? 'stopped' : limit ? 'limit' : 'no_report';
        const lead = limit ? `${runner === 'cursor' ? 'Cursor' : 'Claude'} hit its usage limit. Switch the runner and rerun.` : why;
        await cli(['block', t.id, '--who', 'watcher', '--code', code, '--question', `${lead} Last lines:\n\n${tail}`]).catch(warn);
      }
    }
    writeBoardMd(latest).catch(warn);
    busy = null;
  });
}

async function checkStop() {
  const board = await api('/api/board');
  if (board.runs?.[busy.runId]?.stopRequested) killTree(busy.child);
}

// Returns { code, text } when the ticket cannot start, else null. The code picks the buttons on the board.
// One-shot flags set from the board: stashFirst (stash local changes), skipChecks (run despite deps/decisions).
function preflight(t, board) {
  if (existsSync(path.join(REPO, '.git', 'MERGE_HEAD'))) {
    // A previous agent died in the middle of a merge: drop it, the conflict logic runs again below.
    try { git(['merge', '--abort']); console.log('runner: aborted an unfinished merge'); } catch { /* ignore */ }
  }
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) {
    if (!t.stashFirst) {
      const files = git(['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).slice(0, 8).map((l) => l.slice(3)).join(', ');
      return { code: 'dirty', text: `The elme-hyva working tree on the PC has uncommitted changes (${files}).` };
    }
    git(['stash', 'push', '-m', `board ${t.id} ${new Date().toISOString()}`]);
    console.log(`runner: stashed local changes for ${t.id}`);
  }
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'HEAD') return { code: 'error', text: 'The PC repo is in detached HEAD state.' };
  if (t.holder === 'idea' || t.holder === 'seo') return null;
  try {
    if (!stackUp()) {
      // After a reboot the stack is down (restart: "no"). Start it instead of asking Roman.
      console.log('runner: Docker stack is down, starting it');
      try { execFileSync('docker', ['compose', 'up', '-d'], { cwd: REPO, stdio: 'ignore', timeout: 300_000 }); } catch { /* checked below */ }
      if (!stackUp()) return { code: 'docker', text: 'Docker stack is down and `docker compose up -d` did not bring `elme_php` up. Is Docker running on the PC?' };
    }
  } catch { return { code: 'docker', text: 'Docker is not available on the PC (is the Docker service running?).' }; }
  if (t.skipChecks) return null;
  const tickets = board?.tickets || {};
  const decisions = board?.decisions || {};
  const need = t.kind === 'UX' ? (t.extends || []) : (t.deps || []);
  const openDeps = need.filter((id) => tickets[id]?.status !== 'done');
  if (openDeps.length) return { code: 'deps', text: `Dependencies are not done yet: ${openDeps.join(', ')}.` };
  const openDec = (t.decisions || []).filter((id) => decisions[id]?.status !== 'decided');
  if (openDec.length) return { code: 'decisions', text: `Open decisions: ${openDec.join(', ')}. Decide them, or run anyway.` };
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
        : role === 'seo'
          ? `node .roadmap/app/cli/board.mjs seo ${t.id} --report <file>\nWrite the SEO plan (or review) to the file first. Do not edit code, commit, merge, or block.`
        : role === 'idea'
          ? `node .roadmap/app/cli/board.mjs ideas ${t.id} --verdict ship|push --report <file>\nDo not edit code, commit, merge, or block. ship = leave this screen. push = it still feels like a static catalogue and the report says what to change.`
          : `node .roadmap/app/cli/board.mjs built ${t.id} --commits "<shas>" --summary <file>`) +
      (role === 'idea' || role === 'seo' ? '' : `\nIf blocked: node .roadmap/app/cli/board.mjs block ${t.id} --question "<one question for Roman>"`) +
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
// One stream-json line from `claude -p` → short readable lines for the live run view.
function claudeEvent(line) {
  let e;
  try { e = JSON.parse(line); } catch { return line.trim() ? [line] : []; }
  const out = [];
  if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
    for (const c of e.message.content) {
      if (c.type === 'text' && c.text.trim()) out.push(c.text.trim().split('\n')[0]);
      if (c.type === 'tool_use') {
        const i = c.input || {};
        const what = i.command || i.file_path || i.pattern || i.path || i.description || i.skill || '';
        out.push(`→ ${c.name}${what ? `: ${String(what).split('\n')[0]}` : ''}`);
      }
    }
  } else if (e.type === 'result') {
    out.push(e.is_error ? `✗ ${e.subtype || 'error'}: ${String(e.result || '').split('\n')[0]}` : `✓ finished (${Math.round((e.duration_ms || 0) / 1000)} s)`);
  } else if (e.type === 'system' && e.subtype === 'init') {
    out.push(`claude started · model ${e.model || '?'}`);
  }
  return out;
}

function git(args) { return execFileSync('git', args, { cwd: REPO }).toString(); }
function isAncestor(a, b) { try { git(['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } }
function stackUp() { return execFileSync('docker', ['ps', '--format', '{{.Names}}']).toString().includes('elme_php'); }
// The agent spawns shells and node; kill the whole process group, not just the CLI.
function killTree(child) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 10_000).unref();
}
function existsBranch(b) { try { git(['rev-parse', '--verify', '--quiet', b]); return true; } catch { return false; } }
function hasRemote(name) {
  try { return git(['remote']).split('\n').map((s) => s.trim()).includes(name); }
  catch { return false; }
}
function modelOf(args) {
  const i = args.findIndex((a) => a === '--model' || a.startsWith('--model='));
  if (i < 0) return null;
  return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1] || null;
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
