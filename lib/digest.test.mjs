import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRange, dateIn, shiftDate, digestFacts, digestText, buildDigest } from './digest.mjs';

test('dayRange: a Kyiv day in winter (+2) and in summer (+3)', () => {
  assert.deepEqual(dayRange('2026-11-11'), { from: Date.UTC(2026, 10, 10, 22), to: Date.UTC(2026, 10, 11, 22) });
  assert.deepEqual(dayRange('2026-07-01'), { from: Date.UTC(2026, 5, 30, 21), to: Date.UTC(2026, 6, 1, 21) });
});

test('dayRange: the day the clocks go back is 25 hours', () => {
  const r = dayRange('2026-10-25');
  assert.equal((r.to - r.from) / 3_600_000, 25);
});

test('dayRange: rejects anything that is not a date', () => {
  assert.throws(() => dayRange('yesterday'));
});

test('dateIn and shiftDate', () => {
  assert.equal(dateIn('Europe/Kyiv', Date.UTC(2026, 10, 11, 22, 30)), '2026-11-12');
  assert.equal(dateIn('Europe/Kyiv', Date.UTC(2026, 10, 11, 21, 30)), '2026-11-11');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

const T = (id, title, qa = ['a', 'b'], passed = 2) => ({
  id, title, qa, qaChecks: qa.map((_, i) => (i < passed ? { state: 'passed' } : { state: 'not_checked' })),
});
const tickets = {
  'FE-1': T('FE-1', 'Header counters'), 'FE-2': T('FE-2', 'PDP buy box'), 'FE-3': T('FE-3', 'Mega menu'),
  'FE-4': T('FE-4', 'Footer'), 'BE-1': T('BE-1', 'Minimum order value'), 'FE-5': T('FE-5', 'Cart page'), 'FE-6': T('FE-6', 'Login'),
};
const started = (role) => ({ who: 'watcher', kind: 'log', text: `PC started \`claude\` as the ${role}-engineer on branch \`x\`, model Auto.` });
const built = (line) => ({ who: 'fe', kind: 'log', text: `Done, handed to QA. Commits: a1\n\n${line}` });
const qaOk = { who: 'qa', kind: 'qa_report', text: '## Bugs\nNone.\n\n## Passed' };
const qaBad = { who: 'qa', kind: 'qa_report', text: '## Bugs\n1. The badge is wrong at 390' };
const logs = {
  'FE-1': [started('fe'), built('Synced the cart badge with the server.'), started('qa'), qaBad, started('fe'), built('**Fixed** the badge at 390.'), started('qa'), qaOk,
    { who: 'roman', kind: 'log', text: 'Accepted after review.' }, { who: 'watcher', kind: 'log', text: 'Merged `x` into `main` and pushed origin/main.' }],
  'FE-2': [started('fe'), built('Guest buy box with sign in.'), started('qa'), qaOk],
  'FE-3': [started('fe'), built('Mega menu panels.'), started('qa')],
  'FE-4': [started('fe'), { who: 'watcher', kind: 'question', code: 'no_report', text: 'Agent ended without a report (exit 1).' }],
  'BE-1': [started('be'), { who: 'be', kind: 'question', text: 'Which Pronto field holds the minimum order value?\nMore text' }],
  'FE-5': [{ who: 'seo', kind: 'seo', text: '## SEO plan' }, { who: 'idea', kind: 'ideas', text: 'Verdict: push\n\nreport' }],
  'FE-6': [started('fe'), built('x'), started('qa'), qaBad],
  'GONE-1': [started('fe')],
};

test('digestFacts: every ticket lands where it stood at the end of the day', () => {
  const f = digestFacts(tickets, logs);
  assert.deepEqual(f.shipped.map((i) => i.id), ['FE-1']);
  assert.equal(f.shipped[0].rounds, 2);
  assert.equal(f.shipped[0].detail, 'Fixed the badge at 390.');
  assert.deepEqual(f.review.map((i) => i.id), ['FE-2']);
  assert.deepEqual(f.qa.map((i) => i.id), ['FE-3']);
  assert.deepEqual(f.progress.map((i) => i.id).sort(), ['FE-4', 'FE-6']); // a limit is not a blocker for people; QA bugs go back to work
  assert.deepEqual(f.blocked.map((i) => [i.id, i.question]), [['BE-1', 'Which Pronto field holds the minimum order value?']]);
  assert.deepEqual(f.seo, ['FE-5']);
  assert.deepEqual(f.ideas, [{ id: 'FE-5', verdict: 'push' }]);
  assert.equal(f.runs, 12); // the ticket that is no longer on the board is skipped
});

test('digestText: English, with details', () => {
  const text = digestText(digestFacts(tickets, logs), '2026-11-11', 'en', true);
  assert.match(text, /^Elme Living, update for Wednesday, 11 November\n/);
  assert.match(text, /Done and merged into main \(1\):\n• FE-1 Header counters \(2 rounds of fixes\)\n {3}Fixed the badge at 390\./);
  assert.match(text, /Blocked, needs an answer \(1\):\n• BE-1 Minimum order value\n {3}Which Pronto field/);
  assert.match(text, /Also: SEO plan: FE-5; design review: FE-5\./);
  assert.match(text, /Total: 1 ticket done, 1 waiting for review, 2 of 2 QA checks passed\.$/);
});

test('digestText: Ukrainian, short', () => {
  const text = digestText(digestFacts(tickets, logs), '2026-11-11', 'uk', false);
  assert.match(text, /^Elme Living, апдейт за 11 листопада \(середа\)\n/);
  assert.match(text, /Готово і змержено в main \(1\):\n• FE-1 Header counters \(2 кола правок\)\n\n/);
  assert.match(text, /Разом: 1 тікет закрито, 1 чекає на рев'ю, 2 з 2 QA-перевірок пройдено\.$/);
  assert.ok(!text.includes('Fixed the badge'));
});

test('buildDigest: an empty day and day navigation', () => {
  const d = buildDigest(tickets, {}, '2026-11-11', '2026-11-12');
  assert.match(d.text.en.full, /No ticket moved on the board that day\.$/);
  assert.match(d.text.uk.short, /За цей день тікети на борді не рухались\.$/);
  assert.equal(d.prev, '2026-11-10');
  assert.equal(d.next, '2026-11-12');
  assert.equal(buildDigest(tickets, {}, '2026-11-12', '2026-11-12').next, null);
});
