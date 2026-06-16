import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  const {
    stdin = '',
    timeoutMs = 0,
    cwd = process.cwd(),
    env = process.env,
    onStdoutChunk = null,
    onStderrChunk = null,
    signal = null,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout = null;
    let killTimer = null;

    const cleanup = ({ keepKillTimer = false } = {}) => {
      if (timeout) clearTimeout(timeout);
      if (!keepKillTimer && killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const terminate = (error, signalName = 'SIGTERM') => {
      if (settled) return;
      settled = true;
      child.kill(signalName);
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      killTimer.unref();
      cleanup({ keepKillTimer: true });
      reject(error);
    };

    const onAbort = () => {
      terminate(abortError(signal.reason));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        terminate(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeout.unref();
    }

    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (onStdoutChunk) onStdoutChunk(text);
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (onStderrChunk) onStderrChunk(text);
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
      }
    });
    child.stdin.end(stdin);
  });
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(reason ? String(reason) : 'process aborted');
  error.name = 'AbortError';
  return error;
}
