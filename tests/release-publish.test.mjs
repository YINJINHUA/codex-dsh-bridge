import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePlan, requireGreenChecks, publishAction, shouldPublishEvent, requiredJobs, repository, packageName } from '../scripts/release-plan.mjs';
import { waitForRegistry } from '../scripts/registry-wait.mjs';

const sha = 'a'.repeat(40);
const manifest = { name: packageName, version: '0.4.0', repository: { url: `git+https://github.com/${repository}.git` } };
function event(prerelease = false) { return { action: 'published', repository: { full_name: repository },
  release: { id: 1, draft: false, prerelease, tag_name: 'v0.4.0' } }; }
function run(extra = {}) { return { id: 7, run_number: 3, head_sha: sha, head_branch: 'main',
  head_repository: { full_name: repository }, event: 'push', path: '.github/workflows/check.yml',
  status: 'completed', conclusion: 'success', ...extra }; }
function jobs() { return requiredJobs.map(name => ({ name, run_id: 7, status: 'completed', conclusion: 'success' })); }

test('stable duplicate event is skipped while previews and promotion each have one writer', () => {
  assert.equal(shouldPublishEvent(event()), false);
  assert.equal(shouldPublishEvent({ ...event(), action: 'released' }), true);
  assert.equal(shouldPublishEvent(event(true)), true);
  assert.equal(shouldPublishEvent({ ...event(true), action: 'released' }), false);
  assert.equal(shouldPublishEvent({ ...event(true), action: 'edited' }), false);
  assert.equal(shouldPublishEvent({ ...event(true), repository: { full_name: 'fork/repo' } }), false);
  assert.equal(shouldPublishEvent({ ...event(true), release: { ...event(true).release, draft: true } }), false);
});

function registryFixture() {
  let time = 0, reads = 0, sleeps = [];
  const plan = releasePlan(event(), manifest, sha);
  const ready = { versions: { [plan.version]: { dist: { integrity: 'sha512-same' } } },
    'dist-tags': { latest: plan.version } };
  return { plan, ready, get time() { return time; }, get reads() { return reads; }, sleeps,
    read: fn => async () => { reads++; return fn(time); },
    clock: { now: () => time, sleep: async ms => { sleeps.push(ms); time += ms; } } };
}

test('registry can take more than a minute and stops as soon as both bytes and tag are visible', async () => {
  const f = registryFixture();
  await waitForRegistry(f.read(time => time >= 180000 ? f.ready :
    time >= 90000 ? { ...f.ready, 'dist-tags': { latest: '0.3.8' } } : {}),
  f.plan, 'sha512-same', f.clock);
  assert.equal(f.time, 180000);
  assert.equal(f.reads, 19);
});

test('registry already ready avoids sleeping; persistent absence stops at five minutes', async () => {
  const ready = registryFixture();
  await waitForRegistry(ready.read(() => ready.ready), ready.plan, 'sha512-same', ready.clock);
  assert.equal(ready.reads, 1); assert.deepEqual(ready.sleeps, []);
  const missing = registryFixture();
  await assert.rejects(waitForRegistry(missing.read(() => ({})), missing.plan, 'sha512-same', missing.clock),
    /verification pending/);
  assert.equal(missing.time, 300000);
  assert.equal(missing.reads, 31);
});

test('registry byte conflicts and newer latest stop immediately instead of waiting or overwriting', async () => {
  for (const value of [
    { versions: { '0.4.0': { dist: { integrity: 'sha512-other' } } } },
    { 'dist-tags': { latest: '0.5.0' } }
  ]) {
    const f = registryFixture();
    await assert.rejects(waitForRegistry(f.read(() => value), f.plan, 'sha512-same', f.clock));
    assert.equal(f.reads, 1); assert.deepEqual(f.sleeps, []);
  }
});

test('Release type chooses next or latest; draft, tag mismatch and unstable formal versions fail', () => {
  assert.equal(releasePlan(event(true), manifest, sha).channel, 'next');
  assert.equal(releasePlan(event(), manifest, sha).channel, 'latest');
  assert.equal(releasePlan({ ...event(), action: 'released' }, manifest, sha).channel, 'latest');
  assert.throws(() => releasePlan({ ...event(true), action: 'released' }, manifest, sha));
  for (const value of [{ ...event(), action: 'edited' }, { ...event(), repository: { full_name: 'fork/repo' } },
    { ...event(), release: { ...event().release, draft: true } },
    { ...event(), release: { ...event().release, tag_name: 'v0.4.1' } }]) {
    assert.throws(() => releasePlan(value, manifest, sha));
  }
  const rc = { ...manifest, version: '0.4.1-rc.1' };
  const preview = { ...event(true), release: { ...event(true).release, tag_name: 'v0.4.1-rc.1' } };
  assert.equal(releasePlan(preview, rc, sha).channel, 'next');
  assert.throws(() => releasePlan({ ...preview, release: { ...preview.release, prerelease: false } }, rc, sha));
});

test('publication requires all eight jobs on the latest exact-commit default-branch checks', () => {
  assert.equal(requireGreenChecks([run()], jobs(), sha, 'main').id, 7);
  for (const overrides of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { event: 'pull_request' },
    { status: 'in_progress' }, { conclusion: 'failure' }, { head_repository: { full_name: 'fork/repo' } },
    { path: '.github/workflows/other.yml' }]) {
    assert.throws(() => requireGreenChecks([run(overrides)], jobs(), sha, 'main'));
  }
  assert.throws(() => requireGreenChecks([run(), run({ id: 8, run_number: 4, conclusion: 'failure' })], jobs(), sha, 'main'));
  assert.throws(() => requireGreenChecks([run()], jobs().slice(1), sha, 'main'));
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    const partial = jobs(); partial[4].conclusion = conclusion;
    assert.throws(() => requireGreenChecks([run()], partial, sha, 'main'));
  }
  assert.throws(() => requireGreenChecks([run()], jobs().concat(jobs()[0]), sha, 'main'));
});

test('a retry or next-to-latest promotion requires exactly the published package bytes', () => {
  const plan = releasePlan(event(), manifest, sha);
  assert.equal(publishAction({ versions: {} }, plan, 'sha512-same'), 'publish');
  const metadata = { versions: { '0.4.0': { dist: { integrity: 'sha512-same' } } }, 'dist-tags': { next: '0.4.0' } };
  assert.equal(publishAction(metadata, plan, 'sha512-same'), 'tag');
  metadata['dist-tags'].latest = '0.4.0';
  assert.equal(publishAction(metadata, plan, 'sha512-same'), 'verify');
  assert.throws(() => publishAction(metadata, plan, 'sha512-different'));
  metadata['dist-tags'].latest = '0.5.0';
  assert.throws(() => publishAction(metadata, plan, 'sha512-same'), /backwards/);
  for (const current of ['garbage', '0.5.0-rc.1', '01.0.0']) {
    metadata['dist-tags'].latest = current;
    assert.throws(() => publishAction(metadata, plan, 'sha512-same'), /compare/);
  }
});
