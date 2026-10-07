import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setup } from './dsh-policy-helpers.mjs';
import { configureDsh } from '../lib/dsh-policy.mjs';

test('CLI DSH inherit reaches Host and rejects elevation or use with Codex', { timeout: 180000 }, async t => {
  const f = setup(t); configureDsh(f.base, 'full-access'); await f.listen(true);
  const file = path.join(f.a, 'task.txt'); fs.writeFileSync(file, 'Synthetic authorized worker instructions.');
  const cli = fileURLToPath(new URL('../bin/bridge.mjs', import.meta.url));
  const run = (to, mode) => promisify(execFile)(process.execPath, [cli, 'create', '--project', 'alpha',
    '--to', to, '--request-id', 'cli-inherit', '--title', 'Worker', '--text-file', file, '--dsh-permission', mode],
    { env: { ...process.env, CODEX_DSH_BRIDGE_HOME: f.base }, timeout: 60000 });
  const out = JSON.parse((await run('dsh', 'inherit')).stdout);
  assert.equal(out.ok, true); assert.equal(out.value.permission.source, 'dsh_default');
  for (const [to, mode] of [['codex', 'inherit'], ['dsh', 'full-access']]) {
    await assert.rejects(run(to, mode), error => JSON.parse(error.stdout).error === 'invalid_create_request');
  }
  assert.equal(f.applied.length, 0); assert.equal(f.calls.length, 1);
});

