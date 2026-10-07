import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, sidB, fakeCodex, windowsScript, uuidA } from './helpers.mjs';
import { queueOnce, resolveBinary } from '../lib/process.mjs';
import { readThread } from '../lib/codex.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';
import { privateDir, projectConfig, readJSON, writeNew, replaceJSON, socketPath } from '../lib/config.mjs';
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
# Modify only the DACL; do not request audit/owner writes through Set-Acl.
$acl = [IO.File]::GetAccessControl($r.path, [Security.AccessControl.AccessControlSections]::Access)
$sid = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $r.rights, 'Allow')
$acl.AddAccessRule($rule)
[IO.File]::SetAccessControl($r.path, $acl)`;
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
  const ownerCheck = `$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$acl = Get-Acl -LiteralPath $r.path
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
@{ownerIsCurrentUser=($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value);privateDacl=$acl.AreAccessRulesProtected} | ConvertTo-Json -Compress`;
  const expected = { ownerIsCurrentUser: true, privateDacl: true };
  assert.deepEqual(JSON.parse(windowsScript(ownerCheck, { path: file })), expected);
  replaceJSON(file, { replaced: true });
  assert.deepEqual(readJSON(file), { replaced: true });
  assert.deepEqual(JSON.parse(windowsScript(ownerCheck, { path: file })), expected);
  assert.equal(projectConfig(f.base, 'alpha').roots[0], fs.realpathSync.native(f.a));
  assert.throws(() => privateDir('\\\\invalid-server\\share\\state'), /local_ntfs_required/);
});

test('Windows combined JSON write preserves data and cleans only its own temporary file on failure', native, t => {
  const f = fixture(); t.after(f.cleanup);
  const dir = path.join(f.base, 'new-parent'), file = path.join(dir, 'value.json');
  writeNew(file, { first: true });
  replaceJSON(file, { text: '完整 中文' });
  const expected = { text: '完整 中文' };
  assert.deepEqual(readJSON(file), expected);
  assert.throws(() => replaceJSON(file, { text: 'x'.repeat(65536) }), /unsafe_file/);
  assert.throws(() => writeNew(file, { replaced: true }), e => e.code === 'EEXIST');
  assert.deepEqual(readJSON(file), expected);
  assert.deepEqual(fs.readdirSync(dir), ['value.json']);

  const occupied = path.join(dir, 'occupied.tmp'); writeNew(occupied, { sentinel: true });
  assert.throws(() => windowsSecurity('move', occupied, { destination: file, replace: true,
    prepareParent: true, content: Buffer.from('{}\n').toString('base64') }));
  assert.deepEqual(readJSON(occupied), { sentinel: true });
  assert.deepEqual(readJSON(file), expected);

  const blocked = privateDir(path.join(dir, 'blocked'));
  assert.throws(() => replaceJSON(blocked, { value: true }), /atomic_move_failed/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['blocked', 'occupied.tmp', 'value.json']);
});

test('Windows combined JSON write rechecks parent ACL after a successful write', native, t => {
  const f = fixture(); t.after(f.cleanup);
  const dir = privateDir(path.join(f.base, 'revoked')), file = path.join(dir, 'value.json');
  replaceJSON(file, { first: true });
  windowsScript(`$ErrorActionPreference = 'Stop'
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$acl = [IO.Directory]::GetAccessControl($r.path, [Security.AccessControl.AccessControlSections]::Access)
$sid = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'Read', 'Allow')))
[IO.Directory]::SetAccessControl($r.path, $acl)`, { path: dir });
  assert.throws(() => replaceJSON(file, { overwritten: true }), /unsafe_file/);
  assert.throws(() => writeNew(path.join(dir, 'new.json'), {}), /unsafe_file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { first: true });
  assert.deepEqual(fs.readdirSync(dir), ['value.json']);
});
