import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { privatePatterns as patterns } from './release-rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['.github', '.gitignore', 'bin', 'docs', 'lib', 'locale', 'plugin', 'scripts', 'tests',
  'CHANGELOG.md', 'LICENSE', 'README.md', 'README.en.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'cordis.patch.yml']);
let count = 0;
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dir === root && entry.name === '.git') continue;
    if (dir === root) assert.ok(allowed.has(entry.name), 'unexpected top-level release entry');
    const file = path.join(dir, entry.name), st = fs.lstatSync(file);
    assert.ok(!st.isSymbolicLink(), 'release must not contain symlinks');
    if (st.isDirectory()) { inspect(file); continue; }
    assert.ok(st.isFile() && st.size <= 262144, 'non-regular or oversized source file');
    const data = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
    assert.ok(!data.includes('\0'), 'binary data in source release');
    for (const rule of patterns) assert.ok(!rule.test(data), 'possible sensitive material; inspect file locally');
    const ids = data.match(/(?:session-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [];
    assert.ok(ids.every(id => /^(?:session-)?00000000-0000-4000-8000-00000000000[12]$/.test(id)),
      'non-synthetic conversation identity in release');
    count++;
  }
}

inspect(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'codex-dsh-project-bridge', 'package name mismatch');
assert.equal(manifest.license, 'MIT');
assert.equal(manifest.bin, undefined, 'external CLI shims are not part of the plugin package');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.equal(lock.name, manifest.name, 'lock name mismatch');
assert.equal(lock.packages[''].name, manifest.name, 'lock root name mismatch');
assert.equal(fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').trim(),
  '- insert:\n    - id: codex-project-local-bridge\n      name: ' + manifest.name,
  'DSH bundle must load the published package and retain its plugin identity');
assert.equal(lock.version, manifest.version, 'lock version mismatch');
assert.equal(lock.packages[''].version, manifest.version, 'lock root version mismatch');
const versionPatterns = {
  'bin/bridge.mjs': /项目通信桥 (\d+\.\d+\.\d+)/,
  'lib/codex.mjs': /version: '([^']+)'/,
  'README.md': /^版本 ([^ ]+)/m,
  'README.en.md': /^Version ([^ ]+)/m,
  'docs/RELEASING.md': /^# (\d+\.\d+\.\d+)/m,
  'CHANGELOG.md': /^## (\d+\.\d+\.\d+)/m
};
for (const [name, pattern] of Object.entries(versionPatterns)) {
  assert.equal(fs.readFileSync(path.join(root, name), 'utf8').match(pattern)?.[1], manifest.version, 'version mismatch: ' + name);
}

for (const kind of ['dependencies', 'optionalDependencies', 'devDependencies']) {
  assert.equal(Object.keys(manifest[kind] || {}).length, 0, 'unexpected third-party dependency');
}
for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!manifest.scripts?.[name]);
assert.equal(manifest.private, undefined, 'public release must not be marked private');
assert.deepEqual(manifest.publishConfig, {
  registry: 'https://registry.npmjs.org/', access: 'public', tag: 'next'
}, 'publish destination, visibility and preview tag must be explicit');
assert.deepEqual(manifest.repository, {
  type: 'git', url: 'git+https://github.com/YINJINHUA/codex-dsh-project-bridge.git'
}, 'repository metadata mismatch');
for (const name of ['README.md', 'README.en.md', 'LICENSE', 'SECURITY.md', 'docs/ARCHITECTURE.md', 'docs/SECURITY-REVIEW.md']) {
  assert.ok(fs.statSync(path.join(root, name)).isFile(), 'required public documentation missing');
}
console.log(JSON.stringify({ ok: true, filesChecked: count, thirdPartyDependencies: 0,
  note: 'Targeted hygiene gate, not proof that arbitrary secrets or all vulnerabilities are absent.' }));
