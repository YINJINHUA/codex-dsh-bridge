import fs from 'node:fs';
import { home, privateDir } from '../lib/config.mjs';
import { isWindows, windowsSecurity } from '../lib/windows.mjs';
import { safeError } from '../lib/errors.mjs';
// Local-only, no network/Host calls or file-content reads. Does not repair permissions.
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: safeError(error) }); }
}
check('state_directory', () => {
  if (!fs.existsSync(home())) throw Error('state_directory_missing');
  if (isWindows) windowsSecurity('directory', home());
  else privateDir(home());
});
if (process.argv[2]) check('binary_permissions', () => {
  if (!isWindows) throw Error('windows_only');
  windowsSecurity('binary', process.argv[2]);
});
const ok = checks.every(c => c.ok);
console.log(JSON.stringify({ ok, checks, scope: 'local_permissions', hostConnectivity: 'not_checked',
  note: 'Permission checks only; success does not establish bridge availability. No repair, credential reads or message delivery performed.' }));
process.exitCode = ok ? 0 : 1;
