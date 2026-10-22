import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assign, block, answer, handToQa, qaPassed, qaFailed, done, pickable } from './logic.mjs';

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
    assert.deepEqual([p.status, p.holder, p.waiting], ['done', null, false]);
});

test('pickable returns oldest waiting agent ticket, ignores roman', () => {
    const list = [
        fe({ id: 'A', waiting: true, holder: 'roman', updatedAt: 1 }),
        fe({ id: 'B', waiting: true, holder: 'qa', status: 'in_qa', updatedAt: 5 }),
        fe({ id: 'C', waiting: true, holder: 'fe', status: 'in_progress', updatedAt: 3 }),
        fe({ id: 'D', waiting: false, holder: 'fe', updatedAt: 0 }),
    ];
    assert.equal(pickable(list).id, 'C');
    assert.equal(pickable([fe()]), null);
});

test('every patch sets updatedAt', () => {
    assert.ok(assign(fe(), 'fe').updatedAt > 1);
});
