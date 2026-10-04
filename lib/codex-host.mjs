import path from 'node:path';
import { privateDir, readJSON, replaceJSON, projectConfig, uuid, slug, validId } from './config.mjs';
import { resolveBinary } from './process.mjs';
import { validateCreate } from './creation.mjs';
import { codexCreate } from './codex-create.mjs';
import { codexStatus, codexSend } from './codex.mjs';

// Local setup only. The wire protocol never accepts a binary, argv, environment or shell command.
export function configureCodex(base, binary) {
  if (!path.isAbsolute(binary)) throw Error('codex_binary_must_be_absolute');
  const resolved = resolveBinary(binary);
  replaceJSON(path.join(privateDir(base), 'codex-runtime.json'), { version: 1, binary: resolved });
  return { configured: true, binary: resolved, scope: 'registered_projects_only' };
}

function hostBinary(base) {
  let cfg;
  try { cfg = readJSON(path.join(privateDir(base), 'codex-runtime.json')); }
  catch (error) { throw error.code === 'ENOENT' ? Error('codex_host_not_configured') : error; }
  if (!cfg || Object.keys(cfg).sort().join(',') !== 'binary,version' || cfg.version !== 1 ||
      typeof cfg.binary !== 'string' || !path.isAbsolute(cfg.binary)) throw Error('invalid_codex_runtime');
  return resolveBinary(cfg.binary);
}

export function validateCodex(req) {
  if (!req || req.target !== 'codex') throw Error('invalid_request');
  const { target, ...inner } = req;
  if (inner.op === 'create') { validateCreate(inner); return; }
  const allowed = ['op', 'project', 'session', 'id', 'revision', ...(inner.op === 'send' ? ['text'] : [])];
  if (Object.keys(inner).some(k => !allowed.includes(k)) || !['send', 'status'].includes(inner.op) ||
      !uuid(inner.session) || !slug(inner.project) || !validId(inner.id) ||
      typeof inner.revision !== 'string' || !/^[a-f0-9]{64}$/.test(inner.revision)) throw Error('invalid_request');
  if (inner.op === 'send' && (typeof inner.text !== 'string' || !inner.text.trim() ||
      !inner.text.isWellFormed() || inner.text.includes('\0') || Buffer.byteLength(inner.text) > 8192)) throw Error('invalid_text');
}

export async function handleCodex(req, base, signal) {
  validateCodex(req);
  const { target, ...inner } = req, cfg = projectConfig(base, req.project);
  if (cfg.revision !== req.revision) throw Error('configuration_changed');
  signal?.throwIfAborted();
  const binary = hostBinary(base);
  if (req.op === 'create') return codexCreate(binary, inner, cfg, base, { signal });
  if (req.op === 'send') return codexSend(binary, inner, cfg, base, { signal });
  const result = await codexStatus(binary, req.session, cfg.roots, { signal });
  if (projectConfig(base, req.project).revision !== cfg.revision) throw Error('configuration_changed');
  signal?.throwIfAborted();
  return result;
}
