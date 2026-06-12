import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function clampLogLines(value = '30') {
  const parsed = Number(value || '30');
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.trunc(parsed), 5), 80);
}

export function parseOpsCommand(content) {
  const trimmed = String(content || '').trim();
  if (/^\/(?:ops|admin|运维|救援)$/iu.test(trimmed)) return { action: 'help' };
  if (/^\/(?:version|版本)$/iu.test(trimmed)) return { action: 'version' };
  if (/^\/(?:health|健康)$/iu.test(trimmed)) return { action: 'health' };

  const directLogs = trimmed.match(/^\/(?:logs|日志)(?:\s+(\d+))?$/iu);
  if (directLogs) return { action: 'logs', lines: clampLogLines(directLogs[1]) };

  const opsMatch = trimmed.match(/^\/(?:ops|admin|运维|救援)\s+([A-Za-z-]+|帮助|版本|健康|日志)(?:\s+(\d+))?$/iu);
  if (!opsMatch?.[1]) return null;

  const action = opsMatch[1].toLowerCase();
  if (['help', '帮助'].includes(action)) return { action: 'help' };
  if (['version', '版本'].includes(action)) return { action: 'version' };
  if (['health', 'status', '健康'].includes(action)) return { action: 'health' };
  if (['logs', 'log', '日志'].includes(action)) {
    return { action: 'logs', lines: clampLogLines(opsMatch[2]) };
  }
  return null;
}

export function startupCheckEmoji(state) {
  if (state === 'pass') return 'OK';
  if (state === 'warn') return 'WARN';
  if (state === 'fail') return 'FAIL';
  return 'INFO';
}

export function formatStartupCheckLine(check) {
  return `[${startupCheckEmoji(check.state)}] ${check.label}: ${check.detail}`;
}

export async function checkCodexAppServerSteerSupport(input) {
  const {
    codexBin = 'codex',
    runProcess,
    timeoutMs = 10_000,
    now = () => Date.now(),
  } = input || {};
  const startedAt = now();
  const checkedAt = new Date(startedAt).toISOString();
  let outDir = '';

  const result = (state, detail) => ({
    id: 'codex-app-server-steer',
    label: 'Codex app-server steer',
    state,
    ok: state === 'pass' || state === 'info',
    detail: String(detail || '').slice(0, 240),
    checkedAt,
    durationMs: Math.max(0, now() - startedAt),
  });

  try {
    outDir = mkdtempSync(join(tmpdir(), 'lark-codex-app-server-'));
    await runProcess(codexBin, ['app-server', 'generate-ts', '--out', outDir], {
      timeoutMs,
    });

    const clientRequest = readFileSync(join(outDir, 'ClientRequest.ts'), 'utf8');
    const required = ['turn/steer', 'turn/interrupt'];
    const missing = required.filter(method => !clientRequest.includes(`"method": "${method}"`));
    if (missing.length) return result('fail', `missing protocol method(s): ${missing.join(', ')}`);
    return result('pass', `${required.join(' + ')} available`);
  } catch (error) {
    return result('fail', error?.message || error);
  } finally {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  }
}

export function formatOpsHelp() {
  return [
    'Bridge ops commands:',
    '/health 或 /ops health - 查看 bridge 健康状态',
    '/version 或 /ops version - 查看版本和进程信息',
    '/logs [行数] 或 /ops logs [行数] - 查看最近日志，5-80 行',
  ].join('\n');
}

export function formatHealthReport(input) {
  const checks = Array.isArray(input.startupChecks) && input.startupChecks.length
    ? input.startupChecks.map(formatStartupCheckLine)
    : ['[INFO] Codex app-server steer: pending'];
  return [
    'Lark Codex Bridge Health',
    `time: ${input.timeIso}`,
    `version: ${input.version}`,
    `pid: ${input.pid}`,
    `uptimeSec: ${input.uptimeSec}`,
    `mode: ${input.mode}`,
    `eventEnabled: ${input.eventEnabled ? 'yes' : 'no'}`,
    `http: ${input.httpHost}:${input.httpPort || 0}`,
    `codexCwd: ${input.codexCwd}`,
    `codexRunner: ${input.codexRunner || 'exec'}`,
    `codexSandbox: ${input.codexSandbox}`,
    `codexNonOwnerSandbox: ${input.codexNonOwnerSandbox}`,
    `sessionShareOutput: ${input.sessionShareOutput}`,
    'startupChecks:',
    ...checks,
  ].join('\n');
}

export function formatVersionReport(input) {
  return [
    'Lark Codex Bridge',
    `version: ${input.version}`,
    `pid: ${input.pid}`,
    `uptimeSec: ${input.uptimeSec}`,
  ].join('\n');
}
