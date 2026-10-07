import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { serverChannel, clientChannel } from '../lib/secure-channel.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';
import { fixture } from './helpers.mjs';

test('authenticated channel rejects wrong keys, changed proofs and cross-connection replay', () => {
  const key = randomBytes(32), server = serverChannel(key), client = clientChannel(key, server.hello);
  assert.throws(() => clientChannel(randomBytes(32), server.hello), /authentication_failed/);
  assert.throws(() => clientChannel(key, { ...server.hello, version: 2 }), /authentication_failed/);
  const packet = client.seal({ text: 'synthetic 秘密 message' }, 'request');
  assert.equal(JSON.stringify(packet).includes('synthetic'), false);
  assert.deepEqual(server.open(packet, 'request'), { text: 'synthetic 秘密 message' });
  assert.throws(() => server.open(packet, 'response'), /authentication_failed/);
  assert.throws(() => serverChannel(key).open(packet, 'request'), /authentication_failed/);
  assert.throws(() => server.open({ ...packet, tag: '0'.repeat(32) }, 'request'), /authentication_failed/);
  assert.throws(() => server.open({ ...packet, data: 'x'.repeat(100000) }, 'request'), /authentication_failed/);
});

test('encrypted real transport preserves project checks, receipts and bounded responses', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup); const key = randomBytes(32);
  const stop = await start(f.ctx, f.base, { channelKey: key }); t.after(stop);
  const first = await exchange(f.base, f.req(), { channelKey: key });
  assert.equal(first.value.accepted, true);
  assert.equal((await exchange(f.base, f.req(), { channelKey: key })).value.duplicate, true);
  assert.equal(f.calls.length, 1);
  await assert.rejects(exchange(f.base, f.req('status'), { channelKey: randomBytes(32) }), /authentication_failed/);
  assert.equal(f.calls.length, 1);
});

test('transport reports bridge not ready before startup and after shutdown', { timeout: 60000 }, async t => {
  const f = fixture(); t.after(f.cleanup);
  await assert.rejects(async () => exchange(f.base, f.req('status')), /bridge_not_ready/);
  const stop = await start(f.ctx, f.base);
  try { assert.equal((await exchange(f.base, f.req('status'))).ok, true); }
  finally { await stop(); }
  await assert.rejects(async () => exchange(f.base, f.req('status')), /bridge_not_ready/);
});
