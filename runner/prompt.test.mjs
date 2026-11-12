import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLimit, promptLog, formatLog } from './prompt.mjs';

test('isLimit: the messages Claude and Cursor really print', () => {
  assert.ok(isLimit("You've hit your session limit · resets 2:30pm (Europe/Kyiv)"));
  assert.ok(isLimit("✗ success: You've hit your weekly limit · resets 9pm (Europe/Kyiv)"));
  assert.ok(isLimit("You've hit your limit"));
  assert.ok(isLimit('ActionRequiredError: Weekly usage limit reached. It resets in 3 days.'));
});

test('isLimit: ordinary endings are not a limit', () => {
  assert.ok(!isLimit('Connection lost, reconnecting to https://api2.cursor.sh (attempt 1)...'));
  assert.ok(!isLimit('→ Bash: npx playwright test --reporter=line'));
  assert.ok(!isLimit(''));
});

const start = (role) => [
  { who: role, kind: 'log', text: 'Picked up by claude, branch `fe-1-x`.' },
  { who: 'watcher', kind: 'log', text: 'PC started `claude` as the fe-engineer on branch `fe-1-x`, model Claude Code default.' },
];

test('promptLog: start entries are left out', () => {
  const out = promptLog([...start('fe'), { who: 'fe', kind: 'log', text: 'Done, handed to QA. Commits: a1' }]);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /^Done, handed to QA/);
});

test('promptLog: SEO plan, review, first bug note and builder summary survive a long log', () => {
  const log = [
    { who: 'roman', kind: 'bug', text: 'The price jumps on load' },
    { who: 'seo', kind: 'seo', text: '## SEO plan' },
    { who: 'idea', kind: 'ideas', text: 'Verdict: push' },
  ];
  for (let round = 0; round < 8; round++) {
    log.push(...start('fe'), { who: 'fe', kind: 'log', text: `Done, handed to QA. Commits: r${round}` });
    log.push(...start('qa'), { who: 'qa', kind: 'qa_report', text: `## Bugs round ${round}` });
    log.push({ who: 'watcher', kind: 'question', code: 'dirty', text: 'The working tree has uncommitted changes.' });
  }
  const out = promptLog(log);
  const has = (re) => out.some((e) => re.test(e.text));
  assert.ok(has(/^## SEO plan/));
  assert.ok(has(/^Verdict: push/));
  assert.ok(has(/price jumps/));
  assert.ok(has(/Commits: r7/));
  assert.ok(has(/Bugs round 7/));
  assert.ok(!has(/^Picked up by/));
  // Oldest first, as on the board.
  assert.deepEqual(out, log.filter((e) => out.includes(e)));
});

test('formatLog: empty log and an oversized entry', () => {
  assert.equal(formatLog([]), '(empty)');
  const out = formatLog([{ who: 'seo', kind: 'seo', text: 'x'.repeat(25_000) }]);
  assert.ok(out.length < 20_200);
  assert.match(out, /\[cut, 5000 more characters on the board\]$/);
});
