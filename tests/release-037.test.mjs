import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';
import { register, projectConfig, projectFile, readJSON, replaceJSON, privateDir, claim, digest, writeNew, socketPath } from '../lib/config.mjs';
import { handle } from '../plugin/core.mjs';
import { start } from '../plugin/index.mjs';
import { safeError } from '../lib/errors.mjs';

test('all new registrations reject equal, parent and child state roots', t => {
  const f = fixture(); t.after(f.cleanup);
  const nested = path.join(f.base, 'nested'); fs.mkdirSync(nested);
  for (const root of [f.base, f.dir, nested]) {
    assert.throws(() => register(f.base, 'overlap', [root]), /bridge_state_workspace_overlap/);
    assert.equal(fs.existsSync(path.join(f.base, 'projects', 'overlap.json')), false);
  }
});

test('legacy overlapping registration is rejected before DSH read/send/create', async t => {
  const f = fixture(); t.after(f.cleanup); const req = f.req('status');
  const file = projectFile(f.base, 'alpha'), cfg = readJSON(file), s = fs.statSync(f.dir, { bigint: true });
  cfg.roots = [{ path: f.dir, dev: String(s.dev), ino: String(s.ino) }]; replaceJSON(file, cfg);
  assert.throws(() => projectConfig(f.base, 'alpha'), /bridge_state_workspace_overlap/);
  for (const op of ['status', 'send', 'create']) {
    const request = op === 'create' ? { op, project: 'alpha', root: f.dir, id: 'legacy-create', title: 'test', text: 'test', revision: req.revision } :
      { ...req, op, ...(op === 'send' ? { text: 'test' } : {}) };
    await assert.rejects(handle(f.ctx, request, f.base), /bridge_state_workspace_overlap/);
  }
  assert.equal(f.calls.length, 0);
});

test('concurrent claim sees publication_busy then a complete duplicate, never partial JSON', { skip: process.platform === 'win32' }, t => {
  const f = fixture(); t.after(f.cleanup); const original = fs.writeFileSync;
  const identity = digest('atomic-publish'), key = 'concurrent-key'; let observed;
  fs.writeFileSync = function (fd, data, ...rest) {
    if (typeof fd === 'number' && String(data).includes(identity)) {
      const code = `import {claim} from ${JSON.stringify(new URL('../lib/config.mjs', import.meta.url).href)};
try { claim(process.argv[1],process.argv[2],process.argv[3]); console.log('unexpected'); }
catch(e) { console.log(e.message); }`;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.base, key, identity], { encoding: 'utf8', timeout: 10000 });
      assert.equal(r.status, 0, r.stderr); observed = r.stdout.trim();
    }
    return original.call(fs, fd, data, ...rest);
  };
  let first;
  try { first = claim(f.base, key, identity); } finally { fs.writeFileSync = original; }
  assert.equal(observed, 'publication_busy'); assert.equal(first.fresh, true);
  assert.equal(fs.statSync(first.file).nlink, 1);
  const second = claim(f.base, key, identity); assert.equal(second.fresh, false);
  assert.equal(second.record.identity, identity);
  assert.throws(() => claim(f.base, key, digest('different')), /request_id_conflict/);
});

test('failed POSIX publish leaves no incomplete destination and retains existing contents', { skip: process.platform === 'win32' }, t => {
  const f = fixture(); t.after(f.cleanup); const target = path.join(f.base, 'publish.json'), original = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === target) throw Error('synthetic_publish_failure'); return original(from, to); };
  try { assert.throws(() => writeNew(target, { value: 1 }), /synthetic_publish_failure/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(target + '.publish'), false);
  writeNew(target, { value: 2 }); assert.throws(() => writeNew(target, { value: 3 }), { code: 'EEXIST' });
  assert.deepEqual(readJSON(target), { value: 2 });
});

test('Mac rejects newly added allow ACLs on cached private directories and files', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(); t.after(f.cleanup); const file = path.join(f.base, 'acl.json');
  replaceJSON(file, { value: 1 }); readJSON(file); privateDir(f.base);
  execFileSync('/bin/chmod', ['+a', 'everyone allow read', file]);
  assert.throws(() => readJSON(file), /unsafe_acl/);
  execFileSync('/bin/chmod', ['+a', 'everyone allow read,write,delete,add_file,add_subdirectory', f.base]);
  assert.throws(() => privateDir(f.base), /unsafe_acl/);
});

test('Mac rejects allow ACLs on an ancestor', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(); t.after(f.cleanup);
  execFileSync('/bin/chmod', ['+a', 'everyone allow add_file,add_subdirectory', f.dir]);
  assert.throws(() => privateDir(f.base), /unsafe_acl/);
});

test('connection setup failure destroys the client without crashing Host', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); let stop; t.after(async () => { if (stop) await stop(); f.cleanup(); });
  stop = await start(f.ctx, f.base, { channelKey: Buffer.alloc(1) });
  const client = net.createConnection(socketPath(f.base)); client.on('error', () => {});
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { client.destroy(); reject(Error('client_not_closed')); }, 3000);
    client.once('close', () => { clearTimeout(timeout); resolve(); });
  });
  assert.equal(f.calls.length, 0);
});

test('direct creation rejects a relative configured binary before executing', t => {
  const f = fixture(); t.after(f.cleanup); const text = path.join(f.a, 'prompt.txt'); fs.writeFileSync(text, 'synthetic');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/bridge.mjs', import.meta.url)),
    'create', '--project', 'alpha', '--to', 'codex', '--via', 'direct', '--request-id', 'relative-create',
    '--title', 'Synthetic', '--text-file', text],
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, CODEX_DSH_BRIDGE_HOME: f.base, CODEX_DSH_CODEX: './synthetic' } });
  assert.equal(r.status, 1, r.stderr); assert.equal(JSON.parse(r.stdout).error, 'codex_binary_must_be_absolute');
  assert.equal(fs.existsSync(path.join(f.base, 'creations')), false);
});

test('diagnostic fixed codes survive while arbitrary exception text stays private', () => {
  for (const code of ['publication_busy', 'unsafe_acl', 'posix_acl_check_unavailable', 'codex_invalid_response', 'codex_response_too_large', 'codex_cancelled'])
    assert.equal(safeError(Error(code)), code);
  assert.equal(safeError(Error('sensitive exception detail')), 'bridge_error');
});
