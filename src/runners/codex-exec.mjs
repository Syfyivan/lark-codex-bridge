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
