import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle, validate, summarize } from '../plugin/core.mjs';
import { projectConfig, projectFile, readJSON } from '../lib/config.mjs';
import { fixture, sidA, sidB } from './helpers.mjs';

test('only projects register: a newly attached conversation works without bridge registration', async t => {
  const f = fixture(); t.after(f.cleanup);
  f.members.get(f.a).push(sidB);
  const response = await handle(f.ctx, f.req('send', 'alpha', sidB), f.base);
  assert.equal(response.accepted, true); assert.equal(f.calls[0].sessionId, sidB);
  assert.match(f.calls[0].content[0].text, /非用户新授权/);
  assert.equal(fs.readdirSync(path.join(f.base, 'projects')).length, 2);
});

test('cross-project requests and changed configuration fail before any Host read or send', async t => {
  const f = fixture(); t.after(f.cleanup);
  await assert.rejects(handle(f.ctx, f.req('send', 'alpha', sidB), f.base), /project_mismatch/);
  await assert.rejects(handle(f.ctx, f.req('result', 'beta', sidA), f.base), /project_mismatch/);
  await assert.rejects(handle(f.ctx, { ...f.req(), revision: '0'.repeat(64) }, f.base), /configuration_changed/);
  assert.equal(f.calls.length, 0);
});

test('duplicate is cached across handlers, altered body conflicts, project IDs isolate receipts', async t => {
  const f = fixture(); t.after(f.cleanup);
  const first = await handle(f.ctx, f.req(), f.base);
  const repeat = await handle(f.ctx, f.req(), f.base);
  assert.equal(repeat.duplicate, true); assert.equal(f.calls.length, 1);
  assert.equal(first.hostRequestId, repeat.hostRequestId);
  await assert.rejects(handle(f.ctx, { ...f.req(), text: 'changed' }, f.base), /request_id_conflict/);
  const other = await handle(f.ctx, f.req('send', 'beta', sidB), f.base);
  assert.notEqual(other.hostRequestId, first.hostRequestId);
});

test('uncertain DSH send retains stable Host deduplication key on explicit identical retry', async t => {
  const f = fixture(); t.after(f.cleanup); const ids = [];
  f.ctx.sessionController.prompt = async req => { ids.push(req.requestId); throw Error('interrupted'); };
  await assert.rejects(handle(f.ctx, f.req(), f.base));
  f.ctx.sessionController.prompt = async req => { ids.push(req.requestId); return { accepted: true }; };
  await handle(f.ctx, f.req(), f.base);
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  const receipt = readJSON(path.join(f.base, 'receipts', fs.readdirSync(path.join(f.base, 'receipts'))[0]));
  assert.equal(JSON.stringify(receipt).includes('synthetic communication'), false);
});

test('malformed wire input, extra routing and oversized UTF-8 text fail', () => {
  const f = fixture();
  try {
    for (const req of [null, [], {}, { ...f.req(), text: '汉'.repeat(3000) },
      { ...f.req(), text: '' }, { ...f.req(), project: '../escape' },
      { ...f.req(), command: 'sh' }, { ...f.req(), op: 'execute' },
      { ...f.req(), session: null }, { ...f.req(), id: 'x\n' }]) assert.throws(() => validate(req));
  } finally { f.cleanup(); }
});

test('status/result do not call prompt; old or incomplete results never imply completion', async t => {
  const f = fixture(); t.after(f.cleanup);
  const status = await handle(f.ctx, f.req('status'), f.base);
  assert.equal(status.runtimeStatus, 'idle');
  const result = await handle(f.ctx, f.req('result'), f.base);
  assert.equal(result.latestTurn, null); assert.equal(result.olderHistoryOmitted, true);
  assert.ok(f.calls.every(c => c[0] === 'read'));
  const e = (type, seq, data = {}) => ({ type: 'event', event: { type, seq, data } });
  assert.equal(summarize([e('turn/end', 1)]), null);
  const failed = summarize([e('turn/start', 1), e('turn/end', 2, { reason: { kind: 'error' } })]);
  assert.equal(failed.reason, 'error');
  const running = summarize([e('turn/start', 1), e('assistant/message', 2,
    { message: { content: [{ type: 'text', text: '😀'.repeat(10000) }] } })]);
  assert.equal(running.reason, null); assert.equal(running.truncated, true);
  assert.ok(Buffer.byteLength(running.text) <= 16384);
});

test('unsafe and symlink configuration rejected; deleted project revokes access', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup);
  const file = projectFile(f.base, 'alpha');
  fs.chmodSync(file, 0o644); assert.throws(() => projectConfig(f.base, 'alpha'), /unsafe_file/);
  fs.chmodSync(file, 0o600); const moved = file + '.save'; fs.renameSync(file, moved);
  fs.symlinkSync(moved, file); assert.throws(() => projectConfig(f.base, 'alpha'));
  fs.unlinkSync(file);
  await assert.rejects(handle(f.ctx, f.req('status', 'beta', sidB), f.base).then(() =>
    handle(f.ctx, { op: 'status', project: 'alpha', session: sidA, id: 'x', revision: '0'.repeat(64) }, f.base)));
});
