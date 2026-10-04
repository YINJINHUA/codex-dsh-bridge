import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, sidB } from './helpers.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';

test('isolated server keeps Host membership, deduplication and bounded result semantics', { timeout: 180000 }, async t => {
  const f = fixture(); let stop;
  t.after(async () => { if (stop) await stop(); f.cleanup(); });
  let ticks = 0;
  const heartbeat = setInterval(() => { ticks++; }, 50);
  const began = performance.now();
  try { stop = await start(f.ctx, f.base, { worker: true }); }
  finally { clearInterval(heartbeat); }
  if (process.platform === 'win32' && performance.now() - began > 500) assert.ok(ticks >= 2, 'Host event loop must stay responsive during OS checks');
  assert.equal((await exchange(f.base, f.req())).value.accepted, true);
  assert.equal((await exchange(f.base, f.req())).value.duplicate, true);
  assert.equal(f.calls.filter(call => !Array.isArray(call)).length, 1);
  assert.equal((await exchange(f.base, { ...f.req('status'), session: sidB })).error, 'project_mismatch');
  const result = await exchange(f.base, f.req('result'));
  assert.equal(result.value.latestTurn, null);
  assert.equal(result.value.runtimeStatus, 'idle');
  assert.equal(result.value.olderHistoryOmitted, true);
});

test('isolated server retains unsettled Host lock until actual settlement', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const f = fixture(); let stop;
  t.after(async () => { if (stop) await stop(); f.cleanup(); });
  let release, entered;
  const began = new Promise(resolve => { entered = resolve; });
  f.ctx.sessionController.prompt = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  stop = await start(f.ctx, f.base, { worker: true, requestMs: 100 });
  const first = exchange(f.base, f.req()).catch(() => null);
  await began; await first;
  assert.equal((await exchange(f.base, f.req())).error, 'host_request_unsettled');
  release({ accepted: true });
});
