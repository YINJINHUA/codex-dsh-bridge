import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDir, projectConfig, readJSON, replaceJSON, slug, uuid } from './config.mjs';

const modes = ['workspace-write', 'full-access'];
function file(base, project) {
  if (!slug(project)) throw Error('invalid_project');
  return path.join(base, 'codex-creation-policies', project + '.json');
}
export function validCodexPolicy(value) {
  return !!value && Object.keys(value).sort().join(',') === 'mode,projectRevision,revision,version' &&
    value.version === 1 && modes.includes(value.mode) &&
    typeof value.projectRevision === 'string' && /^[a-f0-9]{64}$/.test(value.projectRevision) &&
    (uuid(value.revision) || (value.revision === 'unset' && value.mode === 'workspace-write'));
}
export function configureCodexCreation(base, project, mode) {
  if (!modes.includes(mode)) throw Error('invalid_codex_creation_permission');
  const cfg = projectConfig(base, project);
  const value = { version: 1, projectRevision: cfg.revision, mode, revision: randomUUID() };
  const target = file(base, project); privateDir(path.dirname(target));
  replaceJSON(target, value);
  return { configured: true, project, ...value, scope: 'future_bridge_created_codex_sessions_in_project',
    existingSessionsUnchanged: true, globalConfigUnchanged: true };
}
export function codexPolicy(base, project) {
  const cfg = projectConfig(base, project);
  privateDir(path.dirname(file(base, project)));
  let value;
  try { value = readJSON(file(base, project)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, projectRevision: cfg.revision, mode: 'workspace-write', revision: 'unset' };
  }
  if (!validCodexPolicy(value) || value.revision === 'unset') throw Error('invalid_codex_creation_policy');
  // Re-registering a project must not silently carry over an old full-access grant.
  if (value.projectRevision !== cfg.revision) throw Error('codex_creation_policy_stale');
  return value;
}
export function checkCodexPolicy(base, project, policy) {
  if (JSON.stringify(codexPolicy(base, project)) !== JSON.stringify(policy)) throw Error('configuration_changed');
}
export function codexLaunchPermission(policy) {
  if (!validCodexPolicy(policy)) throw Error('invalid_codex_creation_policy');
  return { requested: policy.mode, sandbox: policy.mode === 'full-access' ? 'danger-full-access' : 'workspace-write',
    approval: policy.mode === 'full-access' ? 'never' : 'runtime_default',
    policyRevision: policy.revision, source: 'explicit_cli_arguments', verified: false };
}
export function codexPermissionArgs(policy) {
  const permission = codexLaunchPermission(policy);
  return ['--sandbox', permission.sandbox, ...(policy.mode === 'full-access' ? ['-c', 'approval_policy="never"'] : [])];
}
