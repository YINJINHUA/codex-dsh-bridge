import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Independent of package.json.files: removing a files entry must fail validation.
export function expectedPackageFiles(root) {
  const result = [];
  function walk(name) {
    const st = fs.lstatSync(path.join(root, name));
    assert.ok(!st.isSymbolicLink(), 'package source must not contain symlinks');
    if (st.isDirectory()) for (const child of fs.readdirSync(path.join(root, name))) walk(name + '/' + child);
    else { assert.ok(st.isFile(), 'package source must be regular'); result.push({ path: name, size: st.size }); }
  }
  for (const name of ['bin', 'lib', 'plugin', 'locale', 'docs', 'scripts', 'tests', 'package.json',
    'cordis.patch.yml', 'README.md', 'README.en.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE']) walk(name);
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function verifyPack(record, root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(record.name, manifest.name, 'packed package name mismatch');
  assert.equal(record.version, manifest.version, 'packed package version mismatch');
  assert.ok(Array.isArray(record.files), 'missing package file inventory');
  assert.ok(record.files.every(file => typeof file.path === 'string' && Number.isSafeInteger(file.size) &&
    Number.isInteger(file.mode) && (file.mode & 0o022) === 0), 'invalid package entry');
  const actual = record.files.map(({ path, size }) => ({ path, size })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assert.deepEqual(actual, expectedPackageFiles(root), 'package has missing, extra, duplicate or changed files');
  for (const entry of [manifest.main, manifest.exports?.['.'], ...(manifest.dsh?.bundle?.patch || [])]) {
    assert.equal(typeof entry, 'string', 'missing package entry point');
    assert.ok(actual.some(file => file.path === entry.replace(/^\.\//, '')), 'package entry point is absent');
  }
  return { ok: true, filesChecked: actual.length };
}
