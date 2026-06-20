import { createAgentGatewayRunner } from './agent-gateway.mjs';
import { createClaudeCodeRunner } from './claude-code.mjs';
import { createCocoRunner } from './coco.mjs';
import { createCodexBackendRunner } from './codex-exec.mjs';
import { createJwtCheckRunner, createServiceApiRunner } from './service-api.mjs';

export const SUPPORTED_RUNNERS = ['codex', 'claude', 'claude-code', 'coco', 'agent', 'tae', 'api', 'jwt-check'];

export function normalizeRunnerId(value) {
  const normalized = String(value || 'codex').trim().toLowerCase();
  if (normalized === 'claude-code') return 'claude';
  return normalized;
}

export function createRunner(config, deps = {}) {
  const id = normalizeRunnerId(config.backend || config.mode || 'codex');
  if (id === 'codex') return createCodexBackendRunner(config, deps);
  if (id === 'claude') return createClaudeCodeRunner(config, deps);
  if (id === 'coco') return createCocoRunner(config, deps);
  if (id === 'agent' || id === 'tae') return createAgentGatewayRunner({ ...config, mode: id }, deps);
  if (id === 'api') return createServiceApiRunner(config, deps);
  if (id === 'jwt-check') return createJwtCheckRunner(config, deps);
  throw new Error(`Unsupported bridge backend: ${config.backend || config.mode}`);
}
