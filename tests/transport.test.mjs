import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';
import { fixture, sidA, sidB } from './helpers.mjs';
import { register } from '../lib/config.mjs';
import net from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { socketPath } from '../lib/config.mjs';
import { channelKey, serverChannel } from '../lib/secure-channel.mjs';
import { respond } from '../plugin/index.mjs';
import { safeError } from '../lib/errors.mjs';

const cli = fileURLToPath(new URL('../bin/bridge.mjs', import.meta.url));
test('real socket: private permissions, duplicate listener refusal and sanitized errors', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base); t.after(stop);
  assert.equal(fs.statSync(path.join(f.base, 'bridge.sock')).mode & 0o777, 0o600);
  assert.throws(() => start(f.ctx, f.base), /socket_exists/);
  const status = await exchange(f.base, f.req('status'));
  assert.equal(status.ok, true); assert.equal(status.value.sessionId, sidA);
  f.ctx.sessionController.projections = async () => { throw Error('DO_NOT_EXPOSE_HOST_DATA'); };
  assert.deepEqual(await exchange(f.base, f.req('status')), { ok: false, error: 'bridge_error' });
});

test('busy session is isolated; another project still reads, CLI roundtrip targets selected session', async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base); t.after(stop);
  let release, entered; const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  f.ctx.sessionController.prompt = async () => { entered(); await held; return { accepted: true }; };
  const pending = exchange(f.base, f.req());
  await Promise.race([started, pending.then(() => { throw Error('send settled before Host entry'); })]);
  assert.equal((await exchange(f.base, f.req('status'))).error, 'session_busy');
  assert.equal((await exchange(f.base, f.req('status', 'beta', sidB))).ok, true);
  release(); assert.equal((await pending).ok, true);
  const out = await promisify(execFile)(process.execPath,
    [cli, 'status', '--project', 'beta', '--to', 'dsh', '--session', sidB],
    { env: { ...process.env, CODEX_DSH_BRIDGE_HOME: f.base }, timeout: process.platform === 'win32' ? 60000 : 5000 });
  assert.equal(JSON.parse(out.stdout).value.sessionId, sidB);
});

test('configuration update between client read and server dispatch refuses stale route', async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base); t.after(stop);
  const req = f.req();
  fs.unlinkSync(path.join(f.base, 'projects', 'alpha.json')); register(f.base, 'alpha', [f.b]);
  assert.equal((await exchange(f.base, req)).error, 'configuration_changed');
  assert.equal(f.calls.length, 0);
});

test('CLI registration lists projects and never registers conversations', async t => {
  const f = fixture(); t.after(f.cleanup);
  const run = args => promisify(execFile)(process.execPath, [cli, ...args],
    { env: { ...process.env, CODEX_DSH_BRIDGE_HOME: f.base }, timeout: process.platform === 'win32' ? 60000 : 5000 });
  await run(['register', '--project', 'gamma', '--root', f.a]);
  const list = JSON.parse((await run(['projects'])).stdout);
  assert.deepEqual(list.projects.map(p => p.name).sort(), ['alpha', 'beta', 'gamma']);
  await assert.rejects(run(['register', '--project', 'gamma', '--root', f.b]));
  await run(['unregister', '--project', 'gamma']);
  assert.equal(JSON.parse((await run(['projects'])).stdout).projects.length, 2);
});


test('unregistered project is reported explicitly instead of a generic bridge_error', async t => {
  const f = fixture(); t.after(f.cleanup);
  const stop = await start(f.ctx, f.base); t.after(stop);
  const req = { ...f.req('status'), project: 'nosuch' };
  assert.equal((await exchange(f.base, req)).error, 'unknown_project');
});

test('result works with a Host context that rejects undeclared service properties', async t => {
  const f = fixture(); t.after(f.cleanup);
  const ctx = new Proxy({ ...f.ctx, logger: null }, { get(target, property) {
    if (!(property in target)) throw Error('unknown_service');
    return target[property];
  } });
  const stop = await start(ctx, f.base); t.after(stop);
  const result = await exchange(f.base, f.req('result'));
  assert.equal(result.ok, true); assert.equal(result.value.latestTurn, null);
});

test('framing errors and identity mismatch are distinct on plain and authenticated transports', async t => {
  const f = fixture(); t.after(f.cleanup); const req = f.req('status');
  const keys = process.platform === 'win32' ? [channelKey(f.base, true)] : [null, randomBytes(32)];
  for (const key of keys) for (const kind of ['empty', 'truncated', 'newline_missing', 'malformed', 'utf8', 'identity']) {
    const server = net.createServer(client => {
      const channel = key ? serverChannel(key) : null;
      if (channel) client.write(JSON.stringify(channel.hello) + '\n');
      client.once('data', () => {
        const value = { ok: true, requestId: 'wrong-id', project: req.project,
          value: { membershipVerified: true, sessionId: req.session } };
        const packet = JSON.stringify(channel ? channel.seal(value, 'response') : value);
        const wire = { empty: '', truncated: '{"ok":', newline_missing: packet,
          malformed: 'bad\n', utf8: Buffer.from([255, 10]), identity: packet + '\n' }[kind];
        client.end(wire);
      });
    });
    server.listen(socketPath(f.base)); await once(server, 'listening');
    if (process.platform !== 'win32') fs.chmodSync(socketPath(f.base), 0o600);
    try {
      const expected = ['empty', 'truncated', 'newline_missing'].includes(kind) ? 'incomplete_response' :
        kind === 'identity' ? 'response_identity_mismatch' : 'invalid_response';
      await assert.rejects(exchange(f.base, req, { channelKey: key }), e => e.message === expected && safeError(e) === expected);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

test('unsafe socket permissions fail before a connection is made', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup); let connected = false;
  const server = net.createServer(client => { connected = true; client.destroy(); });
  server.listen(socketPath(f.base)); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  fs.chmodSync(socketPath(f.base), 0o666);
  assert.throws(() => exchange(f.base, f.req('status')), /unsafe_socket/);
  assert.equal(connected, false);
});

test('respond drains a bounded large response before closing under backpressure', async t => {
  const payload = { ok: true, value: 'x'.repeat(63000) };
  const expected = JSON.stringify(payload) + '\n';
  const server = net.createServer(client => { client.on('error', () => {}); respond(client, payload); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = net.createConnection(server.address().port, '127.0.0.1');
  t.after(() => client.destroy());
  const chunks = []; client.on('data', chunk => chunks.push(chunk));
  client.pause(); const ended = once(client, 'end');
  await new Promise(resolve => setTimeout(resolve, 50)); client.resume();
  await ended;
  assert.equal(Buffer.concat(chunks).toString(), expected);
});
