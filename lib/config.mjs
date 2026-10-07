import fs from 'node:fs';
import { readBounded } from './read.mjs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isWindows, windowsSecurity, canonicalWindowsPath } from './windows.mjs';
import { checkMacAcl } from './posix-security.mjs';

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
      if (s.isSymbolicLink() || !s.isDirectory() || ![0, process.getuid()].includes(s.uid) ||
          ((s.mode & 0o022) && !(s.mode & 0o1000))) {
        throw Error('unsafe_directory');
      }
      checkMacAcl(current);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function privateDir(dir) {
  if (isWindows) {
    if (!path.isAbsolute(dir) || path.resolve(dir) !== dir) throw Error('canonical_state_directory_required');
    windowsSecurity('prepare', dir); return dir;
  }
  ancestors(dir);
  const created = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = fs.lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) {
    throw Error('unsafe_directory');
  }
  checkMacAcl(dir);
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
  if (isWindows) windowsSecurity('file', file);
  else checkMacAcl(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || (!isWindows && (s.uid !== process.getuid() || (s.mode & 0o077))) || s.size > 65536 || s.nlink !== 1) {
      throw Error('unsafe_file');
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBounded(fd, 65536, 'unsafe_file')));
  } finally { fs.closeSync(fd); }
}

export function syncDir(dir) {
  // Windows publishes state via MoveFileEx WRITE_THROUGH, not a POSIX directory fd.
  if (isWindows) return;
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function writeNew(file, value) {
  if (isWindows) {
    return writeWindowsJSON(file, value, false);
  }
  // A per-path publication lock prevents overwrites; rename exposes only complete,
  // single-link files. Never reap another writer's lock after a timeout/crash.
  const lock = file + '.publish', temporary = path.join(lock, 'value');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try { fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') throw Error('publication_busy'); throw e; }
    throw error;
  }
  try {
    try { fs.lstatSync(file); throw Object.assign(Error('file_exists'), { code: 'EEXIST' }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    syncDir(path.dirname(file));
  } finally {
    try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.rmdirSync(lock);
  }
}

function writeWindowsJSON(file, value, replace) {
  const dir = path.dirname(file);
  if (!path.isAbsolute(dir) || path.resolve(dir) !== dir) throw Error('canonical_state_directory_required');
  const temporary = path.join(dir, randomUUID() + '.tmp');
  // One helper owns preparation, exclusive private creation, flush and publication.
  // No ACL result is cached between operations; existing directories are rechecked.
  windowsSecurity('move', temporary, { destination: file, replace, prepareParent: true,
    content: Buffer.from(JSON.stringify(value) + '\n', 'utf8').toString('base64') });
}

export function assertSeparateState(root, base) {
  const project = fs.realpathSync.native(root), state = fs.realpathSync.native(base);
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
  };
  if (contains(project, state) || contains(state, project)) throw Error('bridge_state_workspace_overlap');
}

export function rootPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('invalid_root');
  const real = isWindows ? fs.realpathSync.native(value) : fs.realpathSync(value);
  const resolved = isWindows ? canonicalWindowsPath(real) : real;
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
  for (const root of roots) assertSeparateState(root, base);
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
  for (const root of canonical) assertSeparateState(root, base);
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
  replaceJSON(file, { ...record, state: 'accepted', value });
}

export function replaceJSON(file, value) {
  if (isWindows) return writeWindowsJSON(file, value, true);
  const temp = path.join(path.dirname(file), randomUUID() + '.tmp');
  try {
    writeNew(temp, value);
    fs.renameSync(temp, file);
    syncDir(path.dirname(file));
  } finally {
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

export function socketPath(base) {
  privateDir(base);
  if (isWindows) return '\\\\.\\pipe\\codex-dsh-' + digest(base.toLowerCase());
  const result = path.join(base, 'bridge.sock');
  if (Buffer.byteLength(result) > 100) throw Error('socket_path_too_long');
  return result;
}
