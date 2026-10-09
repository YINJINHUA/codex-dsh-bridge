import assert from 'node:assert/strict';

export const repository = 'YINJINHUA/codex-dsh-project-bridge';
export const packageName = 'codex-dsh-project-bridge';
export function shouldPublishEvent(event) {
  return event.repository?.full_name === repository && event.release?.draft === false &&
    ((event.action === 'published' && event.release.prerelease === true) ||
     (event.action === 'released' && event.release.prerelease === false));
}
export const requiredJobs = [
  'test (ubuntu-latest, 22)', 'test (ubuntu-latest, 24)',
  'test (macos-latest, 22)', 'test (macos-latest, 24)',
  'Windows tests (1/3)', 'Windows tests (2/3)', 'Windows tests (3/3)',
  'test (windows-latest, 24)'
];

export function releasePlan(event, manifest, sha) {
  assert.equal(event.repository?.full_name, repository, 'unexpected repository');
  assert.ok(['published', 'released'].includes(event.action), 'only publication or stable release events may publish');
  const release = event.release;
  assert.equal(release?.draft, false, 'draft Release');
  assert.equal(typeof release.prerelease, 'boolean', 'missing Release type');
  if (event.action === 'released') assert.equal(release.prerelease, false, 'released event requires a formal Release');
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'invalid Release id');
  assert.match(sha, /^[a-f0-9]{40}$/, 'invalid source commit');
  assert.equal(manifest.name, packageName, 'unexpected package');
  assert.equal(manifest.repository?.url, `git+https://github.com/${repository}.git`);
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  assert.equal(release.tag_name, `v${manifest.version}`, 'Release tag and package version differ');
  assert.ok(release.prerelease || !manifest.version.includes('-'), 'formal Release requires a stable version');
  return { version: manifest.version, tag: release.tag_name, channel: release.prerelease ? 'next' : 'latest', sha,
    releaseId: release.id, filename: `${packageName}-${manifest.version}.tgz` };
}

export function requireGreenChecks(runs, jobs, sha, defaultBranch) {
  const eligible = runs.filter(run => run.head_sha === sha && run.head_repository?.full_name === repository &&
    run.head_branch === defaultBranch && ['push', 'workflow_dispatch'].includes(run.event) &&
    run.path === '.github/workflows/check.yml').sort((a, b) => b.run_number - a.run_number);
  const run = eligible[0];
  assert.ok(run, 'no checks run for this exact commit on the default branch');
  assert.equal(run.status, 'completed', 'current checks are still running');
  assert.equal(run.conclusion, 'success', 'current checks did not pass');
  for (const name of requiredJobs) {
    const matches = jobs.filter(job => job.name === name && job.run_id === run.id);
    assert.equal(matches.length, 1, `missing or duplicate required job: ${name}`);
    assert.equal(matches[0].status, 'completed', `unfinished job: ${name}`);
    assert.equal(matches[0].conclusion, 'success', `unsuccessful job: ${name}`);
  }
  return run;
}

export function publishAction(metadata, plan, integrity) {
  const current = metadata['dist-tags']?.latest;
  if (plan.channel === 'latest' && current !== undefined) {
    assert.match(current, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'cannot safely compare current latest');
    const a = plan.version.split('.').map(BigInt), b = current.split('.').map(BigInt);
    const different = a.findIndex((value, index) => value !== b[index]);
    assert.ok(different < 0 || a[different] > b[different], 'refusing to move latest backwards');
  }
  const existing = metadata.versions?.[plan.version];
  if (!existing) return 'publish';
  assert.equal(existing.dist?.integrity, integrity, 'published version has different bytes; use a new version');
  return metadata['dist-tags']?.[plan.channel] === plan.version ? 'verify' : 'tag';
}
