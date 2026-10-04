import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { privateDir } from '../lib/config.mjs';
import { safeError } from '../lib/errors.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let owned;
try {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    // Do not inherit an absent or sandbox-writable TEMP. Never change an existing ACL.
    const parent = process.env.BRIDGE_TEST_PARENT || path.parse(process.env.SystemRoot || process.cwd()).root;
    const candidate = path.join(parent, 'codex-dsh-test-' + randomUUID());
    if (fs.existsSync(candidate)) throw Error('unsafe_directory');
    privateDir(candidate); owned = candidate;
    env.TEMP = candidate; env.TMP = candidate;
  }
  const files = fs.readdirSync(path.join(root, 'tests')).filter(n => n.endsWith('.test.mjs')).sort();
  const result = spawnSync(process.execPath, ['--test', ...files.map(n => path.join(root, 'tests', n))],
    { cwd: root, env, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: safeError(error), stage: 'test_preflight',
    hint: 'Choose a protected local parent with BRIDGE_TEST_PARENT; do not weaken ACL checks.' }));
  process.exitCode = 1;
} finally {
  // Only this fresh random directory is owned by the test runner, never production state.
  if (owned) fs.rmSync(owned, { recursive: true, force: true });
}
