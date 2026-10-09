import test from 'node:test';
import assert from 'node:assert/strict';
import { privatePatterns } from '../scripts/release-rules.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { verifyPack, expectedPackageFiles } from '../scripts/pack-manifest.mjs';

test('release checks distinguish concrete Windows identity paths from placeholders', () => {
  const blocked = text => privatePatterns.some(rule => rule.test(text));
  const slash = String.fromCharCode(92);
  const home = ['C:', 'Users', 'synthetic-person', 'state'].join(slash);
  const unc = ['', '', 'private-host', 'private-share'].join(slash);
  const extended = ['', '', '?', 'UNC', 'private-host', 'private-share'].join(slash);
  for (const value of [home, JSON.stringify(home), unc, extended]) assert.equal(blocked(value), true);
  for (const value of ['%USERPROFILE%' + slash + '.codex-dsh-bridge', 'C:' + slash + 'path-to-trusted-tools',
    ['', '', '.', 'pipe', 'codex-dsh-example'].join(slash), ['', '', 'invalid-server', 'share'].join(slash)])
    assert.equal(blocked(value), false);
});

test('package inventory rejects missing, extra, duplicate, writable and changed entries', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const files = expectedPackageFiles(root).map(file => ({ ...file, mode: 0o644 }));
  const record = { name: manifest.name, version: manifest.version, files };
  assert.equal(verifyPack(record, root).ok, true);
  for (const bad of [files.filter(f => f.path !== 'plugin/index.mjs'), files.concat({ path: 'private.json', size: 1, mode: 0o644 }),
    files.concat(files[0]), files.map((f, i) => i ? f : { ...f, size: f.size + 1 }),
    files.map((f, i) => i ? f : { ...f, mode: 0o666 })]) {
    assert.throws(() => verifyPack({ ...record, files: bad }, root));
  }
});
