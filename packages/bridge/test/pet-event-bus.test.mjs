import assert from 'node:assert/strict';
import test from 'node:test';

import * as petEvents from '../src/pet-event-bus.mjs';

test('petTokenUsage avoids double-counting persistent Codex sessions', () => {
  assert.equal(typeof petEvents.petTokenUsage, 'function');
  assert.equal(petEvents.petTokenUsage(321, { codexEphemeral: true }), 321);
  assert.equal(petEvents.petTokenUsage(321, { codexEphemeral: false }), 0);
  assert.equal(petEvents.petTokenUsage('invalid', { codexEphemeral: true }), 0);
});
