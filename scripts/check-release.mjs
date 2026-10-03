import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['.github', '.gitignore', 'bin', 'docs', 'lib', 'locale', 'plugin', 'scripts', 'tests',
  'CHANGELOG.md', 'LICENSE', 'README.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'cordis.patch.yml']);
const patterns = [
  /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//,
  /\/Volumes\/[^\s"'`]+/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:sk-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{20,})\b/,
  /(?:api[_-]?key|password|secret)\s*[:=]\s*["'][a-zA-Z0-9+/_=-]{16,}["']/i
];
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
assert.equal(manifest.license, 'MIT');
for (const kind of ['dependencies', 'optionalDependencies', 'devDependencies']) {
  assert.equal(Object.keys(manifest[kind] || {}).length, 0, 'unexpected third-party dependency');
}
for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!manifest.scripts?.[name]);
assert.equal(manifest.private, true, 'npm publishing remains explicitly disabled');
for (const name of ['README.md', 'LICENSE', 'SECURITY.md', 'docs/ARCHITECTURE.md', 'docs/SECURITY-REVIEW.md']) {
  assert.ok(fs.statSync(path.join(root, name)).isFile(), 'required public documentation missing');
}
console.log(JSON.stringify({ ok: true, filesChecked: count, thirdPartyDependencies: 0,
  note: 'Targeted hygiene gate, not proof that arbitrary secrets or all vulnerabilities are absent.' }));
