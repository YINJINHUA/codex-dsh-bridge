import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const home = () => process.env.CODEX_DSH_BRIDGE_HOME || path.join(os.homedir(), '.codex-dsh-bridge');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const slug = value => typeof value === 'string' && value.length <= 48 && /^[a-z]/.test(value) && !/[^a-z0-9-]/.test(value);
export const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[^a-zA-Z0-9-]/.test(value);
export const uuid = value => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

function ancestors(dir) {
  if (!path.isAbsolute(dir)) throw Error('absolute_state_directory_required');
  if (path.resolve(dir) !== dir) throw Error('canonical_state_directory_required');
  let current = path.resolve(dir);
  while (true) {
    try {
      const s = fs.lstatSync(current);
      if (s.isSymbolicLink() || !s.isDirectory() || ((s.mode & 0o022) && !(s.mode & 0o1000))) {
        throw Error('unsafe_directory');
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function privateDir(dir) {
  ancestors(dir);
  const created = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = fs.lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) {
    throw Error('unsafe_directory');
  }
  if (created) {
    let current = path.resolve(dir), boundary = path.dirname(path.resolve(created));
    while (true) {
      syncDir(current);
      if (current === boundary) break;
      current = path.dirname(current);
    }
  }
  return dir;
}

export function readJSON(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 65536 || s.nlink !== 1) {
      throw Error('unsafe_file');
    }
    const bytes = Buffer.alloc(65537);
    const count = fs.readSync(fd, bytes);
    if (count > 65536) throw Error('unsafe_file');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)));
  } finally { fs.closeSync(fd); }
}

export function syncDir(dir) {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function writeNew(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDir(path.dirname(file));
}

export function rootPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('invalid_root');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory() || resolved === path.parse(resolved).root) throw Error('invalid_root');
  return resolved;
}

export function projectFile(base, project) {
  if (!slug(project)) throw Error('invalid_project');
  privateDir(base);
  return path.join(privateDir(path.join(base, 'projects')), project + '.json');
}

function readProject(file) {
  try { return readJSON(file); }
  catch (error) { throw error.code === 'ENOENT' ? Error('unknown_project') : error; }
}

export function projectConfig(base, project) {
  const cfg = readProject(projectFile(base, project));
  if (cfg?.version === 1) throw Error('config_version_unsupported_reregister');
  if (!cfg || Object.keys(cfg).sort().join(',') !== 'registration,roots,version' || cfg.version !== 2 || !uuid(cfg.registration) ||
      !Array.isArray(cfg.roots) || !cfg.roots.length || cfg.roots.length > 16) throw Error('invalid_config');
  const records = cfg.roots.map(r => {
    if (!r || Object.keys(r).sort().join(',') !== 'dev,ino,path') throw Error('invalid_config');
    const current = rootRecord(r.path);
    if (current.path !== r.path || current.dev !== r.dev || current.ino !== r.ino) throw Error('root_changed_reregister');
    return current;
  });
  const roots = records.map(r => r.path);
  if (new Set(roots).size !== roots.length) throw Error('invalid_config');
  return { roots, revision: digest(JSON.stringify([cfg.registration, records])) };
}

function rootRecord(value) {
  const canonical = rootPath(value), s = fs.statSync(canonical, { bigint: true });
  return { path: canonical, dev: String(s.dev), ino: String(s.ino) };
}

export function register(base, project, roots) {
  const file = projectFile(base, project);
  const canonical = [...new Set(roots.map(rootPath))].sort();
  if (!canonical.length || canonical.length > 16) throw Error('invalid_roots');
  writeNew(file, { version: 2, registration: randomUUID(), roots: canonical.map(rootRecord) });
  return { registered: project, roots: canonical };
}

export function claim(base, key, identity) {
  const dir = privateDir(path.join(privateDir(base), 'receipts'));
  const file = path.join(dir, digest(key) + '.json');
  let fresh = false;
  try { writeNew(file, { identity, state: 'pending' }); fresh = true; }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  const record = readJSON(file);
  if (!record || !['pending', 'accepted'].includes(record.state) || typeof record.identity !== 'string' ||
      record.identity.length !== 64 || /[^a-f0-9]/.test(record.identity)) throw Error('invalid_receipt');
  if (record.state === 'accepted') validateReceipt(record.value);
  if (record.identity !== identity) throw Error('request_id_conflict');
  return { file, record, fresh };
}

function validateReceipt(v) {
  if (!v || v.accepted !== true || v.delivery !== 'queued_only' || v.membershipVerified !== true ||
      !validId(v.requestId) || typeof v.sessionId !== 'string' ||
      !uuid(v.sessionId.startsWith('session-') ? v.sessionId.slice(8) : v.sessionId)) throw Error('invalid_receipt');
  if (v.hostRequestId !== undefined && !/^project-bridge-[a-f0-9]{64}$/.test(v.hostRequestId)) throw Error('invalid_receipt');
  const keys = ['sessionId', 'requestId', 'hostRequestId', 'accepted', 'delivery', 'membershipVerified'];
  if (Object.keys(v).some(k => !keys.includes(k))) throw Error('invalid_receipt');
}

export function finish(file, record, value) {
  validateReceipt(value);
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeNew(temp, { ...record, state: 'accepted', value });
    fs.renameSync(temp, file);
    syncDir(path.dirname(file));
  } finally {
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

export function socketPath(base) {
  const result = path.join(privateDir(base), 'bridge.sock');
  if (Buffer.byteLength(result) > 100) throw Error('socket_path_too_long');
  return result;
}
