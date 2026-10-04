import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, sidB, fakeCodex, windowsScript, uuidA } from './helpers.mjs';
import { queueOnce, resolveBinary } from '../lib/process.mjs';
import { readThread } from '../lib/codex.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';
import { privateDir, projectConfig, readJSON, writeNew, socketPath } from '../lib/config.mjs';
import { windowsSecurity } from '../lib/windows.mjs';

const native = { skip: process.platform !== 'win32', timeout: 180000 };
test('Windows native named pipe routes, deduplicates and refuses duplicate listeners', native, async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base); t.after(stop);
  assert.match(socketPath(f.base), /^\\\\\.\\pipe\\codex-dsh-/);
  await assert.rejects(start(f.ctx, f.base));
  assert.equal((await exchange(f.base, f.req())).value.accepted, true);
  assert.equal((await exchange(f.base, f.req())).value.duplicate, true);
  assert.equal(f.calls.length, 1);
  const mismatch = { ...f.req('status'), session: sidB };
  assert.equal((await exchange(f.base, mismatch)).error, 'project_mismatch');
  assert.equal((await exchange(f.base, f.req('status', 'beta', sidB))).ok, true);
});

test('Windows rejects readable state, writable executable and reparse-point state', native, t => {
  const f = fixture(); t.after(f.cleanup);
  const file = path.join(f.base, 'probe.json'); writeNew(file, { test: true });
  const executable = fakeCodex(f);
  assert.equal(resolveBinary(executable), executable);
  const script = `$ErrorActionPreference = 'Stop'
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$acl = Get-Acl -LiteralPath $r.path
$sid = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $r.rights, 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $r.path -AclObject $acl`;
  windowsScript(script, { path: file, rights: 'Read' });
  assert.throws(() => readJSON(file), /unsafe_file/);
  windowsScript(script, { path: executable, rights: 'Write' });
  assert.throws(() => resolveBinary(executable), /codex_unavailable/);
  const junction = path.join(f.dir, 'linked-state');
  fs.symlinkSync(f.base, junction, 'junction');
  assert.throws(() => privateDir(junction), /unsafe_reparse_point/);
  assert.throws(() => resolveBinary(path.join(f.dir, 'fake.cmd')), /codex_unavailable/);
});

test('Windows metadata and queue timeouts stop their owned executable', native, async t => {
  const f = fixture(); t.after(f.cleanup); const executable = fakeCodex(f);
  const keys = ['TEST_PID', 'TEST_QUEUE', 'TEST_QUEUE_HANG', 'TEST_SILENT'];
  const previous = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }));
  process.env.TEST_PID = path.join(f.dir, 'pid');
  process.env.TEST_SILENT = '1';
  await assert.rejects(readThread(executable, uuidA, { timeoutMs: 1500 }), /codex_timeout/);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.throws(() => process.kill(Number(fs.readFileSync(process.env.TEST_PID, 'utf8')), 0), e => e.code === 'ESRCH');
  delete process.env.TEST_SILENT;
  process.env.TEST_QUEUE = path.join(f.dir, 'queue'); process.env.TEST_QUEUE_HANG = '1';
  await assert.rejects(queueOnce(executable, ['queue'], 1500), /delivery_unknown_no_retry/);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.throws(() => process.kill(Number(fs.readFileSync(process.env.TEST_PID, 'utf8')), 0), e => e.code === 'ESRCH');
});

test('Windows state is private and atomic claim never overwrites an existing receipt', native, t => {
  const f = fixture(); t.after(f.cleanup);
  assert.equal(windowsSecurity('prepare', f.base).ok, true);
  const file = path.join(f.base, 'sentinel.json');
  writeNew(file, { first: true });
  assert.throws(() => writeNew(file, { second: true }), e => e.code === 'EEXIST');
  assert.deepEqual(readJSON(file), { first: true });
  assert.equal(projectConfig(f.base, 'alpha').roots[0], fs.realpathSync.native(f.a));
  assert.throws(() => privateDir('\\\\invalid-server\\share\\state'), /local_ntfs_required/);
});
