import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assign, block, answer, handToQa, qaPassed, qaFailed, done, pickable, requestIdeas, ideasDone, ideasRestore, buildFromIdeas } from './logic.mjs';
import { requestSeo, seoDone, reopen } from './logic.mjs';
import { agentKit, kitSettings, kitPrompt } from './logic.mjs';

const fe = (over = {}) => ({ id: 'FE-05', kind: 'FE', status: 'todo', holder: null, waiting: false, prev: null, updatedAt: 1, ...over });

test('assign FE ticket to fe agent starts work', () => {
    const p = assign(fe(), 'fe');
    assert.equal(p.status, 'in_progress');
    assert.equal(p.holder, 'fe');
    assert.equal(p.waiting, true);
});

test('assign to qa puts ticket in QA', () => {
    const p = assign(fe({ status: 'review', holder: 'roman' }), 'qa');
    assert.equal(p.status, 'in_qa');
    assert.equal(p.holder, 'qa');
    assert.equal(p.waiting, true);
});

test('UX ticket cannot go to fe or be', () => {
    const ux = fe({ id: 'UX-04', kind: 'UX' });
    assert.throws(() => assign(ux, 'fe'));
    assert.throws(() => assign(ux, 'be'));
    assert.equal(assign(ux, 'qa').status, 'in_qa');
});

test('block then answer restores status and holder', () => {
    const t = fe({ status: 'in_qa', holder: 'qa', waiting: true });
    const blocked = { ...t, ...block(t) };
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.holder, 'roman');
    assert.equal(blocked.waiting, false);
    const back = { ...blocked, ...answer(blocked) };
    assert.equal(back.status, 'in_qa');
    assert.equal(back.holder, 'qa');
    assert.equal(back.waiting, true);
    assert.equal(back.prev, null);
});

test('answer on a ticket that is not blocked throws', () => {
    assert.throws(() => answer(fe()));
});

test('agent hands to QA, QA passes to Roman, QA fails back to builder', () => {
    const t = fe({ status: 'in_progress', holder: 'be', waiting: true });
    const q = handToQa(t);
    assert.deepEqual([q.status, q.holder, q.waiting], ['in_qa', 'qa', true]);
    const r = qaPassed({ ...t, ...q });
    assert.deepEqual([r.status, r.holder, r.waiting, r.qaVerdict], ['review', 'roman', false, 'passed']);
    const f = qaFailed({ ...t, ...q }, 'be');
    assert.deepEqual([f.status, f.holder, f.waiting, f.qaVerdict], ['in_progress', 'be', true, 'failed']);
});

test('done only from review', () => {
    assert.throws(() => done(fe({ status: 'in_qa' })));
    const p = done(fe({ status: 'review', holder: 'roman' }));
    assert.deepEqual([p.status, p.holder, p.waiting, p.mergeRequested], ['done', null, false, false]);
    const withBranch = done(fe({ status: 'review', holder: 'roman', branch: 'fe-05-top-bar' }));
    assert.equal(withBranch.mergeRequested, true);
});

test('marketing review queues a ticket before work or after it is done', () => {
    const doneTicket = fe({ status: 'done', holder: null, branch: 'fe-05-top-bar' });
    const queuedTodo = requestIdeas(fe({ status: 'todo', holder: null }));
    assert.equal(queuedTodo.holder, 'idea');
    assert.equal(queuedTodo.waiting, true);
    assert.equal(requestIdeas(fe({ status: 'review', holder: 'roman' })).holder, 'idea');
    assert.throws(() => requestIdeas(fe({ status: 'in_progress', holder: 'fe', waiting: true })));
    const queued = { ...doneTicket, ...requestIdeas(doneTicket) };
    assert.equal(queued.status, 'done');
    assert.equal(queued.holder, 'idea');
    assert.equal(queued.waiting, true);
    const back = { ...queued, ...ideasDone(queued, 'push') };
    assert.deepEqual([back.status, back.holder, back.waiting, back.ideaVerdict, back.prev], ['done', null, false, 'push', null]);
    assert.throws(() => ideasDone(queued, 'maybe'));
    const aborted = { ...queued, ...ideasRestore(queued) };
    assert.equal(aborted.status, 'done');
    assert.equal(aborted.holder, null);
    assert.equal(aborted.ideaVerdict, undefined);
});

test('accepting a marketing review sends the ticket back to the builder', () => {
    const doneTicket = fe({ status: 'done', holder: null, builder: 'fe', ideaVerdict: 'push' });
    const back = buildFromIdeas(doneTicket);
    assert.deepEqual([back.status, back.holder, back.waiting], ['in_progress', 'fe', true]);
    const fromTodo = buildFromIdeas(fe({ status: 'todo', holder: null, ideaVerdict: 'push' }));
    assert.deepEqual([fromTodo.status, fromTodo.holder, fromTodo.waiting], ['in_progress', 'fe', true]);
    assert.equal(buildFromIdeas(fe({ status: 'done', kind: 'BE', builder: 'be' })).holder, 'be');
    assert.throws(() => buildFromIdeas(fe({ status: 'done', waiting: true, holder: 'idea' })));
});

test('pickable returns oldest waiting agent ticket, ignores roman', () => {
    const list = [
        fe({ id: 'A', waiting: true, holder: 'roman', updatedAt: 1 }),
        fe({ id: 'B', waiting: true, holder: 'qa', status: 'in_qa', updatedAt: 5 }),
        fe({ id: 'C', waiting: true, holder: 'fe', status: 'in_progress', updatedAt: 3 }),
        fe({ id: 'E', waiting: true, holder: 'idea', status: 'done', updatedAt: 9 }),
        fe({ id: 'D', waiting: false, holder: 'fe', updatedAt: 0 }),
    ];
    assert.equal(pickable(list).id, 'C');
    assert.equal(pickable([fe()]), null);
});

test('every patch sets updatedAt', () => {
    assert.ok(assign(fe(), 'fe').updatedAt > 1);
});

test('SEO plan before the builder: seo first, then fe picks it up', () => {
    const t = fe();
    const s1 = { ...t, ...requestSeo(t, assign(t, 'fe')) };
    assert.deepEqual([s1.status, s1.holder, s1.waiting], ['in_progress', 'seo', true]);
    const s2 = { ...s1, ...seoDone(s1) };
    assert.deepEqual([s2.status, s2.holder, s2.waiting, s2.prev], ['in_progress', 'fe', true, null]);
});

test('SEO review on a done ticket returns it to done, nobody waiting', () => {
    const t = fe({ status: 'done', holder: null });
    const s1 = { ...t, ...requestSeo(t) };
    assert.equal(s1.holder, 'seo');
    const s2 = { ...s1, ...seoDone(s1) };
    assert.deepEqual([s2.status, s2.holder, s2.waiting], ['done', null, false]);
});

test('SEO cannot be requested while an agent works', () => {
    assert.throws(() => requestSeo(fe({ waiting: true, holder: 'fe' })));
});

test('reopen a done ticket: back to fe, QA and merge state cleared', () => {
    const t = fe({ status: 'done', holder: null, qaVerdict: 'passed', qaChecks: [{ state: 'passed' }], mergedAt: 5, branch: 'fe-05-top-bar' });
    const r = reopen(t, 'fe');
    assert.deepEqual([r.status, r.holder, r.waiting, r.qaVerdict, r.mergedAt], ['in_progress', 'fe', true, null, null]);
    assert.deepEqual(r.qaChecks, [null]);
    assert.throws(() => reopen(fe({ status: 'review' }), 'fe'));
    assert.throws(() => reopen(fe({ status: 'done', kind: 'UX' }), 'fe'));
});

import { queued, runNext, cancelQueue, archive, editTicket } from './logic.mjs';

test('queue: Run next priority beats age, archived tickets never queue', () => {
    const a = fe({ id: 'FE-01', waiting: true, holder: 'fe', updatedAt: 1 });
    const b = fe({ id: 'FE-02', waiting: true, holder: 'fe', updatedAt: 5, priority: 1 });
    const c = fe({ id: 'FE-03', waiting: true, holder: 'fe', updatedAt: 0, archived: true });
    assert.deepEqual(queued([a, b, c]).map((t) => t.id), ['FE-02', 'FE-01']);
    assert.equal(pickable([a, b, c]).id, 'FE-02');
    assert.equal(runNext(a, [a, b]).priority, 2);
    assert.equal(assign(fe({ priority: 4 }), 'fe').priority, 0);
});

test('cancel queue: no branch goes back to To do, a branch waits with Roman for Rerun', () => {
    const fresh = cancelQueue(fe({ status: 'in_progress', holder: 'fe', waiting: true }));
    assert.equal(fresh.status, 'todo');
    assert.equal(fresh.waiting, false);
    const built = cancelQueue(fe({ status: 'in_qa', holder: 'qa', waiting: true, branch: 'fe-05-x' }));
    assert.equal(built.status, 'blocked');
    assert.deepEqual(built.prev, { status: 'in_qa', holder: 'qa' });
    assert.deepEqual(answer({ ...fe(), ...built }).holder, 'qa');
    const seo = cancelQueue(fe({ status: 'in_progress', holder: 'seo', waiting: true, prev: { status: 'in_progress', holder: 'fe' } }));
    assert.equal(seo.status, 'todo');
    assert.throws(() => cancelQueue(fe()));
});

test('archive refuses a ticket an agent is on', () => {
    assert.throws(() => archive(fe({ waiting: true })));
    assert.equal(archive(fe()).archived, true);
});

test('edit keeps QA states for unchanged items and drops self-dependency', () => {
    const t = fe({ qa: ['a', 'b'], qaChecks: [{ state: 'passed' }, { state: 'failed' }] });
    const p = editTicket(t, { qa: ['b', ' c ', ''], deps: ['FE-05', 'FE-01'], title: ' New ' });
    assert.deepEqual(p.qa, ['b', 'c']);
    assert.deepEqual(p.qaChecks, [{ state: 'failed' }, null]);
    assert.deepEqual(p.deps, ['FE-01']);
    assert.equal(p.title, 'New');
    assert.throws(() => editTicket(fe({ status: 'review' }), { kind: 'BE' }));
    assert.throws(() => editTicket(fe({ waiting: true }), { title: 'x' }));
});

test('agent kit: lean defaults, ticket choices win, unknown skills dropped', () => {
    const fe = agentKit({ kind: 'FE' });
    assert.deepEqual([fe.superpowers, fe.frontendDesign, fe.playwright, fe.skills.length], [false, true, false, 0]);
    assert.equal(agentKit({ kind: 'BE' }).frontendDesign, false);
    const k = agentKit({ kind: 'BE', kit: { superpowers: true, skills: ['elme-business', 'nope'] } });
    assert.deepEqual([k.superpowers, k.skills], [true, ['elme-business']]);
    const settings = JSON.parse(kitSettings(fe)).enabledPlugins;
    assert.equal(settings['superpowers@claude-plugins-official'], false);
    assert.equal(settings['frontend-design@claude-plugins-official'], true);
    assert.match(kitPrompt(k), /elme-business/);
    assert.doesNotMatch(kitPrompt(k), /no subagents/);
});
