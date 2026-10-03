import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { register, projectFile, projectConfig, claim, digest, privateDir } from '../lib/config.mjs';
import { handle, summarize, validate } from '../plugin/core.mjs';
import { exchange } from '../lib/transport.mjs';
import { fixture, sidA } from './helpers.mjs';
import { start, apply } from '../plugin/index.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('re-registration invalidates requests from the previous registration', async t => {
  const f = fixture(); t.after(f.cleanup); const req = f.req();
  fs.unlinkSync(projectFile(f.base, 'alpha')); register(f.base, 'alpha', [f.a]);
  assert.notEqual(projectConfig(f.base, 'alpha').revision, req.revision);
  await assert.rejects(handle(f.ctx, req, f.base), /configuration_changed/);
  assert.equal(f.calls.length, 0);
});

test('revocation during async membership lookup prevents send', async t => {
  const f = fixture(); t.after(f.cleanup); const req = f.req();
  f.ctx.workspaceRegistry.resolveByPath = async () => {
    fs.unlinkSync(projectFile(f.base, 'alpha')); return { sessionIds: [sidA] };
  };
  await assert.rejects(handle(f.ctx, req, f.base));
  assert.equal(f.calls.length, 0);
});

test('corrupt accepted receipt cannot turn a send into a fabricated success', t => {
  const f = fixture(); t.after(f.cleanup); const identity = digest('message');
  const c = claim(f.base, 'receipt', identity);
  fs.writeFileSync(c.file, JSON.stringify({ identity, state: 'accepted' }));
  assert.throws(() => claim(f.base, 'receipt', identity), /invalid_receipt/);
});

test('transport rejects truthy non-boolean success', async t => {
  const f = fixture(); const endpoint = path.join(f.base, 'bridge.sock'), req = f.req('status');
  const server = net.createServer(client => client.on('data', () => client.end(JSON.stringify({
    ok: 'yes', requestId: req.id, project: req.project, value: { sessionId: req.session }
  }) + '\n')));
  await new Promise(resolve => server.listen(endpoint, resolve)); fs.chmodSync(endpoint, 0o600);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); f.cleanup(); });
  await assert.rejects(exchange(f.base, req), /invalid_response/);
});

test('slow request bytes cannot extend the absolute connection deadline', async t => {
  const f = fixture(); const stop = await start(f.ctx, f.base, { readMs: 150 });
  t.after(async () => { await stop(); f.cleanup(); });
  const client = net.createConnection(path.join(f.base, 'bridge.sock'));
  client.on('error', () => {});
  const started = Date.now(), tick = setInterval(() => client.write(' '), 20);
  try { await new Promise(resolve => client.on('close', resolve)); }
  finally { clearInterval(tick); client.destroy(); }
  assert.ok(Date.now() - started < 1500); assert.equal(f.calls.length, 0);
});

test('slow response bytes cannot extend the absolute client deadline', async t => {
  const f = fixture(); let timer, client;
  const server = net.createServer(c => {
    client = c; c.on('error', () => {}); timer = setInterval(() => c.write(' '), 20);
  });
  const endpoint = path.join(f.base, 'bridge.sock');
  await new Promise(resolve => server.listen(endpoint, resolve)); fs.chmodSync(endpoint, 0o600);
  t.after(async () => { clearInterval(timer); client?.destroy(); await new Promise(r => server.close(r)); f.cleanup(); });
  await assert.rejects(exchange(f.base, f.req('status'), { timeoutMs: 150 }), /transport_timeout/);
});

test('named pipe masquerading as private JSON never blocks the reader', t => {
  const f = fixture(); t.after(f.cleanup); const fifo = path.join(f.dir, 'config-pipe');
  execFileSync('mkfifo', [fifo]); fs.chmodSync(fifo, 0o600);
  const modulePath = new URL('../lib/config.mjs', import.meta.url).href;
  const script = `import { readJSON } from ${JSON.stringify(modulePath)};
try { readJSON(process.argv[1]); process.exit(2); } catch(e) { if(e.message!=='unsafe_file')process.exit(3); }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script, fifo], { timeout: 1500 });
});

test('message pipe rejects before reading, and parent symlinks are refused', t => {
  const f = fixture(); t.after(f.cleanup); const fifo = path.join(f.dir, 'message-pipe');
  execFileSync('mkfifo', [fifo]);
  const cli = fileURLToPath(new URL('../bin/bridge.mjs', import.meta.url));
  let result;
  try { execFileSync(process.execPath, [cli, 'send', '--project', 'alpha', '--to', 'dsh',
    '--session', sidA, '--request-id', 'pipe-1', '--text-file', fifo],
    { env: { ...process.env, CODEX_DSH_BRIDGE_HOME: f.base }, timeout: 1500 }); }
  catch (e) { result = JSON.parse(e.stdout); }
  assert.equal(result.error, 'invalid_text_file');
  fs.symlinkSync(f.base, path.join(f.dir, 'alias'));
  assert.throws(() => privateDir(path.join(f.dir, 'alias', 'child')), /unsafe_directory/);
  assert.throws(() => privateDir(f.dir + '/alias/../redirected'), /canonical_state_directory_required/);
});

test('same pathname with a different directory identity invalidates registration', t => {
  const f = fixture(); t.after(f.cleanup);
  fs.renameSync(f.a, f.a + '-original'); fs.mkdirSync(f.a);
  assert.throws(() => projectConfig(f.base, 'alpha'), /root_changed_reregister/);
});

test('huge Host fragments and request lists are bounded before JSON serialization', () => {
  const event = (type, data = {}) => ({ type: 'event', event: { type, seq: 1, data } });
  const records = [event('turn/start')];
  for (let i = 0; i < 100; i++) records.push(event('user/message', { source: { kind: 'user', rpcId: 'x'.repeat(100) + i } }));
  records.push(event('assistant/message', { message: { content: [{ type: 'text', text: '😀'.repeat(300000) }] } }));
  const result = summarize(records);
  assert.equal(result.requestIds.length, 64); assert.equal(result.requestIdsTruncated, true);
  assert.equal(result.truncated, true); assert.ok(result.text.isWellFormed());
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
});

test('wire text rejects NUL and lone surrogates without activating Host', t => {
  const f = fixture(); t.after(f.cleanup);
  for (const text of ['bad\0text', '\ud800']) assert.throws(() => validate({ ...f.req(), text }), /invalid_text/);
});

test('optional plugin startup failure stays contained and never deletes stale endpoint', async t => {
  const f = fixture(); t.after(f.cleanup); const endpoint = path.join(f.base, 'bridge.sock');
  fs.writeFileSync(endpoint, 'sentinel');
  const previous = process.env.CODEX_DSH_BRIDGE_HOME; process.env.CODEX_DSH_BRIDGE_HOME = f.base;
  let effect, warning;
  try {
    apply({ effect(fn) { effect = fn(); }, logger: { warn(msg) { warning = msg; } } });
    assert.equal(typeof await effect, 'function'); assert.match(warning, /unavailable/);
    assert.equal(fs.readFileSync(endpoint, 'utf8'), 'sentinel');
  } finally {
    if (previous === undefined) delete process.env.CODEX_DSH_BRIDGE_HOME;
    else process.env.CODEX_DSH_BRIDGE_HOME = previous;
  }
});


test('timed-out Host send stays quarantined until it actually settles', async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base, { requestMs: 100 }); t.after(stop);
  let release, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  f.ctx.sessionController.prompt = async () => { calls++; await held; return { accepted: true }; };
  assert.equal((await exchange(f.base, f.req())).error, 'request_timeout_delivery_unknown');
  assert.equal((await exchange(f.base, f.req('send', 'alpha', sidA, 'second'))).error, 'host_request_unsettled');
  assert.equal(calls, 1, 'a timeout must not admit an overlapping Host send');
  const { sidB } = await import('./helpers.mjs');
  assert.equal((await exchange(f.base, f.req('status', 'beta', sidB))).ok, true);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await exchange(f.base, f.req('status'))).ok, true);
  assert.equal((await exchange(f.base, f.req())).value.duplicate, true);
  assert.equal(calls, 1);
});

test('unsettled Host capacity is bounded and reported explicitly', async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base, { requestMs: 100 }); t.after(stop);
  let release, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  f.ctx.sessionController.projections = async () => { calls++; await held; return { asOfSeq: 1 }; };
  const sessions = Array.from({ length: 17 }, (_, i) =>
    'session-00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
  f.members.set(f.a, sessions);
  const replies = await Promise.all(sessions.slice(0, 16).map(s => exchange(f.base, f.req('status', 'alpha', s))));
  assert.ok(replies.every(r => r.error === 'request_timeout_delivery_unknown'));
  assert.equal((await exchange(f.base, f.req('status', 'alpha', sessions[16]))).error, 'host_capacity_unsettled');
  assert.equal(calls, 16);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await exchange(f.base, f.req('status', 'alpha', sessions[16]))).ok, true);
});
