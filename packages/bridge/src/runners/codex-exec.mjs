import { createCodexExecRunner } from '../codex-runner.mjs';
import {
  createCodexAppServerRunner,
  normalizeCodexRuntime,
} from '../codex-app-server.mjs';

export function createCodexBackendRunner(config, deps = {}) {
  const execRunner = createCodexExecRunner(config, deps);
  const runtime = normalizeCodexRuntime(config.codexRuntime);
  if (runtime === 'app-server') return createUnifiedCodexRunner(createCodexAppServerRunner(config, deps));
  if (runtime === 'auto') {
    const appServerRunner = createCodexAppServerRunner(config, deps);
    return {
      id: 'codex',
      label: 'Codex app-server (auto, exec fallback)',
      persistentSessions: appServerRunner.persistentSessions,
      newSession: options => appServerRunner.newSession(options),
      listSessions: options => appServerRunner.listSessions(options),
      useSession: options => appServerRunner.useSession(options),
      activeSession: options => appServerRunner.activeSession(options),
      resolveSession: options => appServerRunner.resolveSession(options),
      async run(prompt, options = {}) {
        try {
          return await appServerRunner.run(prompt, options);
        } catch (error) {
          if (options.signal?.aborted || error?.name === 'AbortError') throw error;
          console.error(`[bridge] codex app-server failed, falling back to exec: ${error.stack || error.message || error}`);
          const text = await execRunner.run(prompt, options);
          return {
            text,
            raw: { runner: execRunner.id, fallback_from: 'codex-app-server' },
            sessionId: '',
            taskId: '',
          };
        }
      },
    };
  }
  return createUnifiedCodexRunner(execRunner);
}

function createUnifiedCodexRunner(runner) {
  return {
    id: 'codex',
    label: runner.label || runner.id,
    persistentSessions: runner.persistentSessions === true,
    ...(typeof runner.newSession === 'function'
      ? { newSession: options => runner.newSession(options) }
      : {}),
    ...(typeof runner.listSessions === 'function'
      ? { listSessions: options => runner.listSessions(options) }
      : {}),
    ...(typeof runner.useSession === 'function'
      ? { useSession: options => runner.useSession(options) }
      : {}),
    ...(typeof runner.activeSession === 'function'
      ? { activeSession: options => runner.activeSession(options) }
      : {}),
    ...(typeof runner.resolveSession === 'function'
      ? { resolveSession: options => runner.resolveSession(options) }
      : {}),
    async run(prompt, options = {}) {
      const result = await runner.run(prompt, options);
      if (result && typeof result === 'object' && 'text' in result) return result;
      return {
        text: result,
        raw: { runner: runner.id },
        sessionId: '',
        taskId: '',
      };
    },
  };
}
