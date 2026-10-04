import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('default state stays under the user home even with a different AppData location', () => {
  const env = { ...process.env, LOCALAPPDATA: path.join(os.tmpdir(), 'untrusted-appdata') };
  delete env.CODEX_DSH_BRIDGE_HOME;
  const config = new URL('../lib/config.mjs', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { home } from ${JSON.stringify(config)}; console.log(JSON.stringify(home()));`],
  { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(JSON.parse(out), path.join(os.homedir(), '.codex-dsh-bridge'));
});
