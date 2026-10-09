import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { publishAction } from './release-plan.mjs';

// Only reads are retried. Never re-publish a package because propagation is slow.
export async function waitForRegistry(read, plan, integrity, {
  timeoutMs = 300000, intervalMs = 10000,
  now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onPending = () => {}
} = {}) {
  const start = now();
  for (;;) {
    const metadata = await read();
    // Also rejects different bytes and a newer latest; waiting cannot repair either.
    if (publishAction(metadata, plan, integrity) === 'verify') return metadata;
    const remaining = timeoutMs - (now() - start);
    assert.ok(remaining > 0,
      'registry verification pending after waiting; inspect before rerunning (never republish blindly)');
    onPending(Math.round((now() - start) / 1000));
    await sleep(Math.min(intervalMs, remaining));
  }
}
