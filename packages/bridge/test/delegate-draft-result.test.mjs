import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDelegateDraftResult } from '../src/delegate-draft-result.mjs';

test('parseDelegateDraftResult accepts the structured delegate reply contract', () => {
  const result = parseDelegateDraftResult(JSON.stringify({
    operation_plan: ['Review the latest merge request revision.'],
    reply_text: 'The latest revision has no blocking findings.',
    evidence: ['All required checks passed.'],
    confidence: 'high',
  }));

  assert.deepEqual(result, {
    operationPlan: 'Review the latest merge request revision.',
    replyText: 'The latest revision has no blocking findings.',
    evidence: 'All required checks passed.',
    confidence: 'high',
    raw: JSON.stringify({
      operation_plan: ['Review the latest merge request revision.'],
      reply_text: 'The latest revision has no blocking findings.',
      evidence: ['All required checks passed.'],
      confidence: 'high',
    }),
  });
});

test('parseDelegateDraftResult rejects unstructured progress commentary', () => {
  assert.throws(
    () => parseDelegateDraftResult('I will inspect the remaining evidence before replying.'),
    /structured JSON object/i,
  );
});

test('parseDelegateDraftResult rejects a structured draft without reply_text', () => {
  assert.throws(
    () => parseDelegateDraftResult(JSON.stringify({
      operation_plan: ['Keep investigating.'],
      evidence: [],
      confidence: 'medium',
    })),
    /reply_text/i,
  );
});
