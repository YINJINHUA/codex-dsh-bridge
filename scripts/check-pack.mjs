import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { verifyPack } from './pack-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.npm_execpath, 'run with npm run check:pack');
const packed = JSON.parse(execFileSync(process.execPath,
  [process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json'],
  { cwd: root, encoding: 'utf8', timeout: 60000 }));
assert.equal(packed.length, 1);
console.log(JSON.stringify(verifyPack(packed[0], root)));
