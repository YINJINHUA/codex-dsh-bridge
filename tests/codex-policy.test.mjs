import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, fakeCodex, uuidA } from './helpers.mjs';
import { configureCodexCreation, codexPolicy, checkCodexPolicy, codexPermissionArgs } from '../lib/codex-policy.mjs';
import { projectConfig, projectFile, replaceJSON, register, readJSON } from '../lib/config.mjs';
import { creationClaim, creationSaved } from '../lib/creation.mjs';
import { codexCreate } from '../lib/codex-create.mjs';
import { validateCodex } from '../lib/codex-host.mjs';

function setup(t) {
  const f = fixture(); t.after(f.cleanup);
  const cfg = projectConfig(f.base, 'alpha');
  const req = { op: 'create', project: 'alpha', id: 'policy-one', revision: cfg.revision,
    root: f.a, title: 'Synthetic policy child', text: 'Synthetic test only' };
  return { ...f, cfg, req };
}

test('Codex policy is opt-in per registered project, stale registration fails closed and wire cannot set it', t => {
  const f = setup(t);
  const baseline = codexPolicy(f.base, 'alpha');
  assert.equal(baseline.mode, 'workspace-write');
  assert.deepEqual(codexPermissionArgs(baseline), ['--sandbox', 'workspace-write']);
  configureCodexCreation(f.base, 'alpha', 'full-access');
  const full = codexPolicy(f.base, 'alpha');
  assert.deepEqual(codexPermissionArgs(full), ['--sandbox', 'danger-full-access', '-c', 'approval_policy="never"']);
  assert.equal(codexPolicy(f.base, 'beta').mode, 'workspace-write');
  assert.throws(() => checkCodexPolicy(f.base, 'alpha', baseline), /configuration_changed/);
  for (const mode of [undefined, 'inherit', 'danger-full-access']) {
    assert.throws(() => configureCodexCreation(f.base, 'alpha', mode), /invalid_codex_creation_permission/);
  }
  for (const field of ['permission', 'policy', 'sandbox', 'approval']) {
    assert.throws(() => validateCodex({ ...f.req, target: 'codex', [field]: 'full-access' }), /invalid_create_request/);
  }
  fs.unlinkSync(projectFile(f.base, 'alpha')); register(f.base, 'alpha', [f.a]);
  assert.throws(() => codexPolicy(f.base, 'alpha'), /codex_creation_policy_stale/);
  configureCodexCreation(f.base, 'alpha', 'workspace-write');
  assert.equal(codexPolicy(f.base, 'alpha').mode, 'workspace-write');
});

test('Codex policy rejects malformed, forged default and linked policy files', t => {
  const f = setup(t); configureCodexCreation(f.base, 'alpha', 'full-access');
  const file = path.join(f.base, 'codex-creation-policies', 'alpha.json');
  const original = readJSON(file);
  for (const value of [{ ...original, revision: '-'.repeat(36) }, { ...original, revision: 'unset' },
    { ...original, extra: true }, { ...original, mode: 'auto' }]) {
    replaceJSON(file, value); assert.throws(() => codexPolicy(f.base, 'alpha'), /invalid_codex_creation_policy/);
  }
  replaceJSON(file, original);
  fs.linkSync(file, path.join(f.dir, 'hardlink-policy'));
  assert.throws(() => codexPolicy(f.base, 'alpha'), /unsafe_file/);
});

test('creation snapshots policy but replays original and legacy receipts without upgrading', t => {
  const f = setup(t), initial = codexPolicy(f.base, 'alpha');
  const claim = creationClaim(f.base, 'codex', f.req, initial);
  assert.deepEqual(readJSON(claim.file).policy, initial);
  const value = { sessionId: uuidA, requestId: f.req.id, created: true, membershipVerified: true, permission: { requested: 'workspace-write' } };
  creationSaved(claim, uuidA, value);
  configureCodexCreation(f.base, 'alpha', 'full-access');
  const replay = creationClaim(f.base, 'codex', f.req, codexPolicy(f.base, 'alpha'));
  assert.equal(replay.fresh, false); assert.deepEqual(replay.record.value, value);
  const legacy = readJSON(claim.file); delete legacy.policy; replaceJSON(claim.file, legacy);
  assert.deepEqual(creationClaim(f.base, 'codex', f.req, codexPolicy(f.base, 'alpha')).record.value, value);
  const pendingReq = { ...f.req, id: 'pending' };
  creationClaim(f.base, 'codex', pendingReq, codexPolicy(f.base, 'alpha'));
  configureCodexCreation(f.base, 'alpha', 'workspace-write');
  assert.throws(() => creationClaim(f.base, 'codex', pendingReq, codexPolicy(f.base, 'alpha')), /creation_unknown_no_retry/);
});

function executable(f, mode = 'ok') {
  const original = fakeCodex(f), binary = path.join(f.dir, 'policy-codex.mjs');
  const log = path.join(f.dir, 'exec-argv');
  const module = new URL('../lib/codex-policy.mjs', import.meta.url).href;
  fs.writeFileSync(binary, `#!/usr/bin/env node
import fs from 'node:fs';
if(process.argv[2]!=='exec'){await import(${JSON.stringify(pathToFileURL(original).href)});}
else {
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');
 console.log(JSON.stringify({type:'thread.started',thread_id:${JSON.stringify(uuidA)}}));
 ${mode === 'revoke' ? `const {configureCodexCreation}=await import(${JSON.stringify(module)});configureCodexCreation(${JSON.stringify(f.base)},'alpha','workspace-write');` : ''}
 console.log(JSON.stringify({type:${JSON.stringify(mode === 'fail' ? 'turn.failed' : 'turn.completed')}}));
}
`); fs.chmodSync(binary, 0o700);
  return { binary, log };
}
function metadataRoot(t, f) {
  const previous = process.env.TEST_ROOT; process.env.TEST_ROOT = f.a;
  t.after(() => { if (previous === undefined) delete process.env.TEST_ROOT; else process.env.TEST_ROOT = previous; });
}

test('full-access exec passes only fixed policy flags and records unverified requested permissions', { skip: process.platform === 'win32' }, async t => {
  const f = setup(t); metadataRoot(t, f); configureCodexCreation(f.base, 'alpha', 'full-access');
  const { binary, log } = executable(f);
  const value = await codexCreate(binary, f.req, f.cfg, f.base);
  const args = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.deepEqual(args.slice(args.indexOf('--sandbox')), ['--sandbox', 'danger-full-access', '-c', 'approval_policy="never"', '-']);
  assert.equal(args.includes('--add-dir'), false); assert.equal(args.includes(f.base), false);
  assert.equal(value.permission.sandbox, 'danger-full-access'); assert.equal(value.permission.approval, 'never');
  assert.equal(value.permission.verified, false); assert.equal(value.bridgeStateAccess, 'host_user_access_possible');
  configureCodexCreation(f.base, 'alpha', 'workspace-write');
  const duplicate = await codexCreate(binary, f.req, f.cfg, f.base);
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.permission, value.permission);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

test('policy revoked after claiming prevents exec and preserves an uncertain non-retryable intent', { skip: process.platform === 'win32' }, async t => {
  const f = setup(t); configureCodexCreation(f.base, 'alpha', 'full-access');
  const { binary, log } = executable(f); const original = fs.fsyncSync; let changed = false;
  fs.fsyncSync = function(fd) {
    original(fd);
    if (!changed && fs.existsSync(path.join(f.base, 'creations')) && fs.readdirSync(path.join(f.base, 'creations')).length) {
      changed = true; configureCodexCreation(f.base, 'alpha', 'workspace-write');
    }
  };
  try { await assert.rejects(codexCreate(binary, f.req, f.cfg, f.base), /configuration_changed/); }
  finally { fs.fsyncSync = original; }
  assert.equal(changed, true); assert.equal(fs.existsSync(log), false);
  await assert.rejects(codexCreate(binary, f.req, f.cfg, f.base), /creation_unknown_no_retry/);
});

for (const mode of ['revoke', 'fail']) test(`in-flight ${mode} keeps created identity and never starts replacement`, { skip: process.platform === 'win32' }, async t => {
  const f = setup(t); metadataRoot(t, f); configureCodexCreation(f.base, 'alpha', 'full-access');
  const { binary, log } = executable(f, mode);
  await assert.rejects(codexCreate(binary, f.req, f.cfg, f.base), mode === 'revoke' ? /configuration_changed/ : /creation_unknown_no_retry/);
  await assert.rejects(codexCreate(binary, f.req, f.cfg, f.base), /creation_unknown_no_retry/);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
  const record = readJSON(path.join(f.base, 'creations', fs.readdirSync(path.join(f.base, 'creations'))[0]));
  assert.equal(record.sessionId, uuidA); assert.equal(record.policy.mode, 'full-access');
});
