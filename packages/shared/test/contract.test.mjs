import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PET_EVENT_TYPES,
  PET_SOURCES,
  DEFAULT_PET_SOURCE,
  isPetEventType,
  isPetSource,
  normalizeSource,
} from '../index.mjs';

test('event type vocabulary covers bridge + kodama events', () => {
  for (const t of [
    'task_started', 'task_progress', 'task_done', 'task_failed', 'task_waiting',
    'lark_message_received', 'lark_reply_sent', 'pomodoro_completed', 'agent_done',
  ]) {
    assert.ok(isPetEventType(t), `${t} should be a known type`);
  }
  assert.ok(!isPetEventType('nope'));
  assert.ok(!isPetEventType(undefined));
});

test('sources and default', () => {
  assert.ok(isPetSource(PET_SOURCES.LARK));
  assert.ok(isPetSource(PET_SOURCES.LOCAL));
  assert.ok(!isPetSource('cloud'));
  assert.equal(DEFAULT_PET_SOURCE, PET_SOURCES.LARK);
});

test('normalizeSource falls back to local for unknown', () => {
  assert.equal(normalizeSource('lark'), 'lark');
  assert.equal(normalizeSource('local'), 'local');
  assert.equal(normalizeSource('whatever'), 'local');
  assert.equal(normalizeSource(undefined), 'local');
});

test('PET_EVENT_TYPES is frozen', () => {
  assert.throws(() => { PET_EVENT_TYPES.NEW = 'x'; });
});
