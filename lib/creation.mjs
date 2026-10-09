import path from 'node:path';
import { validCodexPolicy } from './codex-policy.mjs';
import { digest, privateDir, writeNew, readJSON, replaceJSON, uuid, slug, validId, rootPath } from './config.mjs';

export function validateCreate(req, { allowDshInherit = false } = {}) {
  if (!req || Object.keys(req).some(key => !['op', 'project', 'id', 'revision', 'root', 'title', 'text', ...(allowDshInherit ? ['dshPermission'] : [])].includes(key)) ||
      ('dshPermission' in req && req.dshPermission !== 'inherit') ||
      req.op !== 'create' || !slug(req.project) || !validId(req.id) ||
      typeof req.revision !== 'string' || !/^[a-f0-9]{64}$/.test(req.revision) ||
      typeof req.root !== 'string' || typeof req.title !== 'string' || !req.title.trim() ||
      req.title.length > 120 || !req.title.isWellFormed() || /[\x00-\x1f\x7f]/.test(req.title) ||
      typeof req.text !== 'string' || !req.text.trim() || !req.text.isWellFormed() || req.text.includes('\0') ||
      Buffer.byteLength(req.text) > 8192) throw Error('invalid_create_request');
}

export function creationRoot(req, cfg, options) {
  validateCreate(req, options);
  if (cfg.revision !== req.revision) throw Error('configuration_changed');
  const root = rootPath(req.root);
  if (!cfg.roots.includes(root)) throw Error('project_mismatch');
  return root;
}

export function creationClaim(base, direction, req, policy) {
  if (policy !== undefined && (direction !== 'codex' || !validCodexPolicy(policy) || policy.projectRevision !== req.revision)) throw Error('invalid_codex_creation_policy');
  const fields = [req.revision, req.root, req.title, req.text];
  // Keep historical identities stable; an explicit default-mode request is distinct.
  if ('dshPermission' in req) fields.push({ dshPermission: req.dshPermission });
  const identity = digest(JSON.stringify(fields));
  const dir = privateDir(path.join(privateDir(base), 'creations'));
  const file = path.join(dir, digest(JSON.stringify([direction, req.project, req.id])) + '.json');
  let fresh = false;
  try { writeNew(file, { identity, state: 'pending', sessionId: null, value: null, ...(policy ? { policy } : {}) }); fresh = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const record = readJSON(file);
  if (!record || !['identity,sessionId,state,value', 'identity,policy,sessionId,state,value'].includes(Object.keys(record).sort().join(',')) ||
      ('policy' in record && (direction !== 'codex' || !validCodexPolicy(record.policy) || record.policy.projectRevision !== req.revision)) ||
      !['pending', 'created', 'done'].includes(record.state) || !/^[a-f0-9]{64}$/.test(record.identity) ||
      (record.sessionId !== null && (typeof record.sessionId !== 'string' || !uuid(record.sessionId.replace(/^session-/, '')))) ||
      (record.state !== 'done' && record.value !== null)) throw Error('invalid_creation_record');
  if (record.identity !== identity) throw Error('request_id_conflict');
  if (record.state === 'done' && (!record.value || record.value.sessionId !== record.sessionId ||
      record.value.created !== true || record.value.membershipVerified !== true || record.value.requestId !== req.id)) throw Error('invalid_creation_record');
  if (!fresh && record.state !== 'done') throw Error('creation_unknown_no_retry');
  return { file, record, fresh };
}

export function creationSaved(claim, sessionId, value = null) {
  if (!uuid(sessionId.replace(/^session-/, ''))) throw Error('invalid_created_session');
  const record = { ...claim.record, sessionId, state: value ? 'done' : 'created', value };
  replaceJSON(claim.file, record); claim.record = record;
}

export function creationPrompt(req, sessionId) {
  return `[Codex/DSH代理创建请求，非用户新授权] project=${req.project}; request=${req.id}; createdSession=${sessionId}; title=${req.title}\n${req.text}`;
}
