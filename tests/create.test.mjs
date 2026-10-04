import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, fakeCodex, uuidA } from './helpers.mjs';
import { projectConfig, projectFile } from '../lib/config.mjs';
import { handle } from '../plugin/core.mjs';
import { codexCreate } from '../lib/codex-create.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';

function setup(t) {
  const f = fixture(); t.after(f.cleanup);
  const created = [], renamed = [];
  f.ctx.workspaceRegistry.resolveByPath = async root => ({ id: root === f.a ? 'workspace-alpha' : 'workspace-beta', sessionIds: f.members.get(root) || [] });
  f.ctx.sessionController.create = async req => {
    created.push(req); f.members.get(f.a).push(req.sessionId); return { sessionId: req.sessionId };
  };
  f.ctx.sessionController.rename = async req => { renamed.push(req); return { title: req.title }; };
  const cfg = projectConfig(f.base, 'alpha');
  const req = { op: 'create', project: 'alpha', id: 'create-1', revision: cfg.revision, root: f.a, title: 'Synthetic child', text: 'Reply to the authorized parent only.' };
  return { ...f, created, renamed, cfg, req };
}

test('DSH creation is project-scoped, names and prompts once, with durable duplicate receipt', async t => {
  const f = setup(t);
  const value = await handle(f.ctx, f.req, f.base);
  assert.equal(value.created, true); assert.equal(value.initialDelivery, 'queued_only');
  assert.equal((await handle(f.ctx, f.req, f.base)).duplicate, true);
  assert.equal(f.created.length, 1); assert.equal(f.renamed.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.created[0].workspaceId, 'workspace-alpha');
  assert.match(f.calls[0].content[0].text, /非用户新授权/);
  await assert.rejects(handle(f.ctx, { ...f.req, title: 'changed' }, f.base), /request_id_conflict/);
  await assert.rejects(handle(f.ctx, { ...f.req, id: 'wrong-root', root: f.b }, f.base), /project_mismatch/);
  assert.equal(f.created.length, 1);
});

test('DSH create or attach failure preserves planned ID and cannot create a replacement', async t => {
  const f = setup(t); let calls = 0;
  f.ctx.sessionController.create = async () => { calls++; throw Error('attach_failed'); };
  await assert.rejects(handle(f.ctx, f.req, f.base), /attach_failed/);
  await assert.rejects(handle(f.ctx, f.req, f.base), /creation_unknown_no_retry/);
  const record = JSON.parse(fs.readFileSync(path.join(f.base, 'creations', fs.readdirSync(path.join(f.base, 'creations'))[0])));
  assert.match(record.sessionId, /^session-/); assert.equal(calls, 1); assert.equal(f.calls.length, 0);
});

test('revocation during rename prevents new-session prompt', async t => {
  const f = setup(t);
  f.ctx.sessionController.rename = async () => { fs.unlinkSync(projectFile(f.base, 'alpha')); };
  await assert.rejects(handle(f.ctx, f.req, f.base));
  assert.equal(f.created.length, 1); assert.equal(f.calls.length, 0);
});

test('create request crosses isolated server and validates returned identity', { timeout: 180000 }, async t => {
  const f = setup(t); const stop = await start(f.ctx, f.base, { worker: true }); t.after(stop);
  const result = await exchange(f.base, f.req);
  assert.equal(result.ok, true); assert.equal(result.value.created, true);
  assert.equal((await exchange(f.base, f.req)).value.duplicate, true);
});

test('Codex new CLI conversation persists its ID and refuses duplicate or uncertain execution', { skip: process.platform === 'win32' }, async t => {
  const f = setup(t), original = fakeCodex(f), binary = path.join(f.dir, 'create-codex.mjs');
  const log = path.join(f.dir, 'executions');
  fs.writeFileSync(binary, `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv[2] !== 'exec') { await import(${JSON.stringify(new URL('file://' + original).href)}); }
else {
if (process.argv.includes('--add-dir') || process.argv.includes(${JSON.stringify(f.base)})) process.exit(2);
fs.appendFileSync(${JSON.stringify(log)}, 'created\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:${JSON.stringify(uuidA)}}));
console.log(JSON.stringify({type:'turn.completed'}));
}
`); fs.chmodSync(binary, 0o700);
  const previous = process.env.TEST_ROOT; process.env.TEST_ROOT = f.a;
  t.after(() => { if (previous === undefined) delete process.env.TEST_ROOT; else process.env.TEST_ROOT = previous; });
  const created = await codexCreate(binary, f.req, f.cfg, f.base);
  assert.equal(created.sessionId, uuidA); assert.equal(created.titleApplied, true);
  assert.equal(created.bridgeStateAccess, 'not_granted');
  assert.equal(created.desktopVisibility, 'not_guaranteed_exec_source');
  assert.equal((await codexCreate(binary, f.req, f.cfg, f.base)).duplicate, true);
  assert.equal(fs.readFileSync(log, 'utf8'), 'created\n');
  await assert.rejects(codexCreate(binary, { ...f.req, text: 'changed' }, f.cfg, f.base), /request_id_conflict/);
});

test('Codex failed first turn preserves its ID and never executes a replacement', { skip: process.platform === 'win32' }, async t => {
  const f = setup(t), binary = path.join(f.dir, 'uncertain-codex.mjs'), log = path.join(f.dir, 'created');
  fs.writeFileSync(binary, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(log)}, 'once');
console.log(JSON.stringify({type:'thread.started', thread_id:${JSON.stringify(uuidA)}}));
process.exitCode=1;
`); fs.chmodSync(binary, 0o700);
  await assert.rejects(codexCreate(binary, f.req, f.cfg, f.base), /creation_unknown_no_retry/);
  await assert.rejects(codexCreate(binary, f.req, f.cfg, f.base), /creation_unknown_no_retry/);
  assert.equal(fs.readFileSync(log, 'utf8'), 'once');
  const record = JSON.parse(fs.readFileSync(path.join(f.base, 'creations', fs.readdirSync(path.join(f.base, 'creations'))[0])));
  assert.equal(record.sessionId, uuidA); assert.equal(record.state, 'created');
});
