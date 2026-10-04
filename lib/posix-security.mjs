import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// ACL changes update ctime. Keep a bounded cache, never a permanent path allowlist.
const checked = new Map();
const stamp = s => [s.dev, s.ino, s.ctimeNs, s.mode, s.uid].join(':');
export function checkMacAcl(file) {
  if (process.platform !== 'darwin') return;
  const beforeStat = fs.lstatSync(file, { bigint: true }), before = stamp(beforeStat);
  if (checked.get(file) === before) return;
  const result = spawnSync('/bin/ls', ['-lde', '--', file], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 65536, env: { ...process.env, LC_ALL: 'C' }
  });
  if (result.error || result.status !== 0) throw Error('posix_acl_check_unavailable');
  const entries = result.stdout.trimEnd().split('\n').slice(1);
  // Deny entries only restrict access. Conservatively refuse all allow/unknown ACEs.
  if (entries.some(line => !/^\s*\d+: .+ deny [a-z_,]+$/.test(line))) throw Error('unsafe_acl');
  const afterStat = fs.lstatSync(file, { bigint: true });
  if (['dev', 'ino', 'mode', 'uid'].some(k => beforeStat[k] !== afterStat[k])) throw Error('configuration_changed');
  // A directory ctime also changes when unrelated children are created. Do not
  // reject shared /tmp churn, but never cache a check spanning such a change.
  if (stamp(afterStat) !== before) return;
  if (checked.size >= 256) checked.clear();
  checked.set(file, before);
}
