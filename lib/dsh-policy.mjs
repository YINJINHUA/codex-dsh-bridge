import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDir, readJSON, replaceJSON, uuid } from './config.mjs';

const modes = ['inherit', 'full-access'];
const policyFile = base => path.join(base, 'dsh-creation-policy.json');

// Local configuration only; never accepted as a field in a wire request.
export function configureDsh(base, permission) {
  if (!modes.includes(permission)) throw Error('invalid_dsh_creation_permission');
  const value = { version: 1, newSessionPermission: permission, revision: randomUUID() };
  replaceJSON(policyFile(privateDir(base)), value);
  return { configured: true, ...value, scope: 'bridge_created_dsh_sessions_only',
    existingSessionsUnchanged: true, dshDefaultUnchanged: true };
}

export function dshPolicy(base) {
  let value;
  try { value = readJSON(policyFile(base)); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, newSessionPermission: 'inherit', revision: 'unset' };
    throw error;
  }
  if (!value || Object.keys(value).sort().join(',') !== 'newSessionPermission,revision,version' ||
      value.version !== 1 || !modes.includes(value.newSessionPermission) ||
      !uuid(value.revision)) {
    throw Error('invalid_dsh_creation_policy');
  }
  return value;
}

export function checkDshPolicy(base, policy) {
  if (JSON.stringify(dshPolicy(base)) !== JSON.stringify(policy)) throw Error('configuration_changed');
}
