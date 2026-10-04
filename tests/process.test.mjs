import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { queueOnce, resolveBinary } from '../lib/process.mjs';
import { readThread } from '../lib/codex.mjs';
import { fixture, uuidA } from './helpers.mjs';

function stubborn(f) {
  const executable = path.join(f.dir, 'stubborn.mjs'), pidFile = path.join(f.dir, 'pid');
  fs.writeFileSync(executable, `#!/usr/bin/env node
import fs from 'node:fs';
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
setInterval(()=>{},1000);
`); fs.chmodSync(executable, 0o700);
  return { executable, pidFile };
}

async function verifyGone(pidFile) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.throws(() => process.kill(pid, 0), e => e.code === 'ESRCH');
}

test('metadata reader kills its own SIGTERM-resistant child after timeout', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup); const { executable, pidFile } = stubborn(f);
  await assert.rejects(readThread(executable, uuidA, { timeoutMs: 1500 }), /codex_timeout/);
  await verifyGone(pidFile);
});

test('queue timeout is bounded even if its own child ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup); const { executable, pidFile } = stubborn(f);
  await assert.rejects(queueOnce(executable, [], 1500), /delivery_unknown_no_retry/);
  await verifyGone(pidFile);
});

test('executable discovery refuses writable binaries and relative PATH entries', { skip: process.platform === 'win32' }, t => {
  const f = fixture(); t.after(f.cleanup);
  const file = path.join(f.dir, 'codex'); fs.writeFileSync(file, '#!/bin/sh\nexit 0\n'); fs.chmodSync(file, 0o777);
  assert.throws(() => resolveBinary(file), /codex_unavailable/);
  fs.chmodSync(file, 0o700);
  const previous = process.env.PATH; process.env.PATH = '.';
  try { assert.throws(() => resolveBinary('codex'), /codex_unavailable/); }
  finally { process.env.PATH = previous; }
});
