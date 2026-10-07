import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const isWindows = process.platform === 'win32';
let encoded;
export function windowsSecurity(action, target, extra = {}) {
  if (!isWindows) throw Error('windows_only');
  const system = process.env.SystemRoot;
  if (!system || !path.isAbsolute(system)) throw Error('windows_security_system_root_missing');
  const binary = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Do not inherit PowerShell 7/Codex or user module search paths into Windows PowerShell 5.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  env.PSModulePath = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  // Only this shipped, static program is encoded. Paths are JSON data over stdin.
  encoded ??= Buffer.from(fs.readFileSync(new URL('./windows-security.ps1', import.meta.url), 'utf8'), 'utf16le').toString('base64');
  const result = spawnSync(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: JSON.stringify({ action, path: target, ...extra }), encoding: 'utf8',
    timeout: 10000, maxBuffer: 8192, windowsHide: true, env
  });
  if (result.error) throw Error(result.error.code === 'ETIMEDOUT' ? 'windows_security_timeout' :
    result.error.code === 'ENOBUFS' ? 'windows_security_output_limit' : 'windows_security_spawn_failed');
  if (result.status !== 0) throw Error('windows_security_exit_failed');
  let value;
  try { value = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch { throw Error('windows_security_invalid_response'); }
  if (value.ok !== true) {
    const error = Error(['unsafe_directory', 'unsafe_file', 'local_ntfs_required', 'unsafe_binary',
      'unsafe_reparse_point', 'atomic_move_failed'].includes(value.error) ? value.error :
      value.code === 'ENOENT' ? 'state_file_missing' : value.code === 'EEXIST' ? 'state_file_exists' : 'windows_security_unavailable');
    if (value.code === 'EEXIST' || value.code === 'ENOENT') error.code = value.code;
    throw error;
  }
  return value;
}

export function canonicalWindowsPath(value) {
  // Windows realpath converts mapped drives to UNC. Preserve case: NTFS may enable case sensitivity.
  return value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
}
