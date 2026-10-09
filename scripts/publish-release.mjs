// Only run in the release workflow. No persistent npm credentials are read or created here.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { releasePlan, requireGreenChecks, publishAction, shouldPublishEvent, repository, packageName } from './release-plan.mjs';
import { verifyPack } from './pack-manifest.mjs';
import { waitForRegistry } from './registry-wait.mjs';

const env = process.env;
assert.equal(env.GITHUB_EVENT_NAME, 'release');
const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
if (!shouldPublishEvent(event)) {
  console.log('No publication for this event/type; the matching channel event handles it.');
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const plan = releasePlan(event, manifest, env.GITHUB_SHA);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), plan.sha);
const apiBase = `https://api.github.com/repos/${repository}`;
async function request(url, { github = false, ...options } = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/json', ...(github ? { Authorization: `Bearer ${env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28' } : {}), ...options.headers } });
  assert.ok(response.ok, `HTTP ${response.status} from ${new URL(url).hostname}`);
  return response;
}
async function github(suffix) { return (await request(apiBase + suffix, { github: true })).json(); }
async function checkRelease() {
  const live = await github(`/releases/${plan.releaseId}`);
  assert.equal(live.tag_name, plan.tag, 'Release tag changed');
  assert.equal(live.draft, false, 'Release is now a draft');
  assert.equal(live.prerelease, event.release.prerelease, 'Release type changed; run its new event');
  const commit = await github(`/commits/${encodeURIComponent(plan.tag)}`);
  assert.equal(commit.sha, plan.sha, 'tag moved after this workflow started');
  return live;
}
await checkRelease();
const runs = (await github(`/actions/workflows/check.yml/runs?head_sha=${plan.sha}&per_page=100`)).workflow_runs;
const selected = runs.filter(r => r.head_sha === plan.sha && r.head_branch === event.repository.default_branch &&
  ['push', 'workflow_dispatch'].includes(r.event) && r.head_repository?.full_name === repository &&
  r.path === '.github/workflows/check.yml').sort((a, b) => b.run_number - a.run_number)[0];
assert.ok(selected, 'wait for checks on the release commit before publishing');
const jobs = (await github(`/actions/runs/${selected.id}/attempts/${selected.run_attempt}/jobs?per_page=100`)).jobs;
requireGreenChecks(runs, jobs, plan.sha, event.repository.default_branch);

const output = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'npm-release-'));
function npm(args) {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !['GH_TOKEN', 'GITHUB_TOKEN'].includes(key)));
  return execFileSync('npm', args, { env: childEnv, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'inherit'] });
}
const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output]));
assert.equal(packed.length, 1);
assert.equal(packed[0].filename, plan.filename);
verifyPack(packed[0], process.cwd());
const tarball = path.join(output, plan.filename);
const bytes = fs.readFileSync(tarball);
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
assert.equal(packed[0].integrity, integrity);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const checksum = Buffer.from(`${sha256}  ${plan.filename}\n`);
const registry = 'https://registry.npmjs.org/';
async function metadata() { return (await request(registry + packageName)).json(); }
const before = await metadata();
const action = publishAction(before, plan, integrity);
// Check the live release again immediately before the irreversible registry operation.
const live = await checkRelease();
if (action === 'publish') {
  npm(['publish', tarball, '--ignore-scripts', '--access', 'public', '--tag', plan.channel,
    '--registry=' + registry, '--provenance']);
} else if (action === 'tag') {
  npm(['dist-tag', 'add', `${packageName}@${plan.version}`, plan.channel, '--registry=' + registry]);
}
// Registry propagation may lag; only these read-only verification requests are retried.
await waitForRegistry(metadata, plan, integrity, {
  onPending: seconds => console.log(`Waiting for registry visibility: ${seconds}s elapsed (up to 300s; read-only).`)
});
// Never replace an existing release attachment with different bytes.
for (const [name, data] of [[plan.filename, bytes], ['SHA256SUMS.txt', checksum]]) {
  const assets = live.assets.filter(asset => asset.name === name);
  assert.ok(assets.length <= 1, 'duplicate release attachment');
  if (assets.length) {
    assert.equal(assets[0].digest, 'sha256:' + createHash('sha256').update(data).digest('hex'),
      'existing attachment differs or has no digest; inspect manually');
  } else {
    await request(`https://uploads.github.com/repos/${repository}/releases/${plan.releaseId}/assets?name=${encodeURIComponent(name)}`,
      { github: true, method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
  }
}
const summary = `Published ${packageName}@${plan.version} to ${plan.channel}\nCommit: ${plan.sha}\nCI run: ${selected.id}\nSHA256: ${sha256}\nOperation: ${action}\n`;
fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
