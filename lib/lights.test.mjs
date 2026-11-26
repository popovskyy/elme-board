import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLights, lightsTodo, wishPatch, reportPatch, lightsKeyMayCall } from './lights.mjs';

test('nothing to do before the first press', () => {
  assert.equal(lightsTodo(emptyLights()), null);
  assert.equal(lightsTodo(null), null);
});

test('a new wish is open until the runner reports it handled', () => {
  const l = { ...emptyLights(), ...wishPatch({ want: false }, 1000) };
  assert.equal(lightsTodo(l), false);
  assert.equal(lightsTodo({ ...l, appliedAt: 1000 }), null);
  // a second press after that opens a new wish
  assert.equal(lightsTodo({ ...l, appliedAt: 1000, ...wishPatch({ want: true }, 2000) }), true);
});

test('wish must be a real boolean', () => {
  assert.throws(() => wishPatch({ want: 'off' }, 1), /true or false/);
  assert.throws(() => wishPatch({}, 1), /true or false/);
  assert.throws(() => wishPatch(null, 1), /true or false/);
  assert.deepEqual(wishPatch({ want: true, appliedAt: 99, actual: false }, 5), { want: true, wantAt: 5, error: null });
});

test('report takes only actual, appliedAt and error', () => {
  assert.deepEqual(reportPatch({ actual: true, appliedAt: 7, error: null, want: false, wantAt: 99 }, 50), {
    actualAt: 50, actual: true, appliedAt: 7, error: null,
  });
  assert.deepEqual(reportPatch({ actual: null, error: 'dashboard is down' }, 60), { actualAt: 60, actual: null, error: 'dashboard is down' });
  assert.equal(reportPatch({ actual: 'yes' }, 1).actual, undefined);
  assert.equal(reportPatch({ error: 'x'.repeat(500) }, 1).error.length, 200);
  assert.deepEqual(reportPatch(undefined, 3), { actualAt: 3 });
});

test('the light-only key reaches /api/lights GET and POST and nothing else', () => {
  assert.equal(lightsKeyMayCall('/api/lights', 'GET'), true);
  assert.equal(lightsKeyMayCall('/api/lights', 'POST'), true);
  assert.equal(lightsKeyMayCall('/api/lights', 'PATCH'), false); // the runner's report needs BOARD_TOKEN
  assert.equal(lightsKeyMayCall('/api/lights', 'DELETE'), false);
  assert.equal(lightsKeyMayCall('/api/lights/x', 'GET'), false);
  assert.equal(lightsKeyMayCall('/api/tickets', 'GET'), false);
  assert.equal(lightsKeyMayCall('/api/lightsX', 'POST'), false);
  assert.equal(lightsKeyMayCall('/api/runner/next', 'GET'), false);
});
