import fs from 'node:fs';
const original = fs.chmodSync;
let observed = null;
fs.chmodSync = function (target, mode, ...rest) {
  if (observed === null && typeof target === 'string' && target.endsWith('.sock')) {
    try { observed = (fs.statSync(target).mode & 0o777).toString(8); }
    catch (e) { observed = 'stat-failed:' + e.code; }
  }
  return original.call(this, target, mode, ...rest);
};
process.on('exit', () => console.log('SOCKET_MODE_BEFORE_CHMOD=' + (observed ?? 'never-called')));
