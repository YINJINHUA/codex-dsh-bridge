import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function resolveBinary(binary) {
  if (typeof binary !== 'string') throw Error('invalid_binary');
  const candidates = path.isAbsolute(binary) ? [binary] : binary === 'codex' ?
    (process.env.PATH || '').split(path.delimiter).filter(path.isAbsolute).map(p => path.join(p, binary)) : [];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate), s = fs.statSync(real);
      if (!s.isFile() || (s.mode & 0o022) || ![0, process.getuid()].includes(s.uid)) continue;
      fs.accessSync(real, fs.constants.X_OK); return real;
    } catch { /* An unusable entry is never executed. */ }
  }
  throw Error('codex_unavailable');
}

export function stopOwned(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 250);
  child.once('close', () => clearTimeout(timer));
}

export function queueOnce(binary, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let done = false, size = 0;
    const timer = setTimeout(() => end(false), timeoutMs);
    function end(success) {
      if (done) return;
      done = true; clearTimeout(timer); stopOwned(child);
      success ? resolve() : reject(Error('delivery_unknown_no_retry'));
    }
    child.on('error', () => end(false));
    child.on('close', (code, signal) => end(code === 0 && signal === null));
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 65536) end(false); });
  });
}
