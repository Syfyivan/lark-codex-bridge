import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  const {
    stdin = '',
    timeoutMs = 0,
    cwd = process.cwd(),
    env = process.env,
    onStdoutChunk = null,
    onStderrChunk = null,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout = null;

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
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
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
      }
    });
    child.stdin.end(stdin);
  });
}
