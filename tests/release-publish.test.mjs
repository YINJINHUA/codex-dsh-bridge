import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePlan, requireGreenChecks, publishAction, requiredJobs, repository, packageName } from '../scripts/release-plan.mjs';

const sha = 'a'.repeat(40);
const manifest = { name: packageName, version: '0.4.0', repository: { url: `git+https://github.com/${repository}.git` } };
function event(prerelease = false) { return { action: 'published', repository: { full_name: repository },
  release: { id: 1, draft: false, prerelease, tag_name: 'v0.4.0' } }; }
function run(extra = {}) { return { id: 7, run_number: 3, head_sha: sha, head_branch: 'main',
  head_repository: { full_name: repository }, event: 'push', path: '.github/workflows/check.yml',
  status: 'completed', conclusion: 'success', ...extra }; }
function jobs() { return requiredJobs.map(name => ({ name, run_id: 7, status: 'completed', conclusion: 'success' })); }

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
