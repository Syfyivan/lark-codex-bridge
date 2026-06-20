// Cross-package drift guard: the whole reason packages/shared exists. Ensures
// the bridge (producer) and Kodama (consumer) never disagree with the contract
// without a test going red. Adds no runtime dependency to either package — the
// bridge stays zero-dep/publishable and Kodama's renderer is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PET_EVENT_TYPES,
  PET_SOURCES,
  isPetEventType,
  isPetSource,
} from '../index.mjs';
// pet-config.js is a pure data export (no browser globals), so it imports in Node.
import { PET_CONFIG } from '../../kodama/src/renderer/config/pet-config.js';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const CONTRACT_TYPES = new Set(Object.values(PET_EVENT_TYPES));

test('bridge only emits event types the contract knows', () => {
  const src = readFileSync(here('../../bridge/lark-codex-bridge.mjs'), 'utf8');
  const emitted = new Set(
    [...src.matchAll(/emitPet\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  );
  assert.ok(emitted.size > 0, 'expected to find emitPet(...) calls in the bridge');
  for (const type of emitted) {
    assert.ok(isPetEventType(type), `bridge emits "${type}" which is not in the contract`);
  }
});

test('Kodama reacts only to event types in the contract', () => {
  for (const type of Object.keys(PET_CONFIG.events)) {
    assert.ok(isPetEventType(type), `Kodama reacts to "${type}" which is not in the contract`);
  }
});

test('Kodama handles every event type the contract defines', () => {
  for (const type of CONTRACT_TYPES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PET_CONFIG.events, type),
      `contract defines "${type}" but Kodama has no reaction for it`,
    );
  }
});

test('Kodama source labels match the contract sources', () => {
  const configured = Object.keys(PET_CONFIG.sources);
  for (const s of configured) {
    assert.ok(isPetSource(s), `Kodama labels source "${s}" which is not in the contract`);
  }
  for (const s of Object.values(PET_SOURCES)) {
    assert.ok(configured.includes(s), `contract source "${s}" has no Kodama label`);
  }
});
