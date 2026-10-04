import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('socket is private before chmod and listen restores the Host umask immediately', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sockmode-'));
  try {
    fs.chmodSync(dir, 0o700);
    const base = path.join(dir, 'state');
    const root = path.join(dir, 'workspace'); fs.mkdirSync(root);
    const child = `
      import assert from 'node:assert/strict';
      const { register } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/config.mjs', import.meta.url)))});
      const { start } = await import(${JSON.stringify(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)))});
      register(process.argv[1], 'alpha', [process.argv[2]]);
      process.umask(0o022);
      const pending = start({ }, process.argv[1]);
      assert.equal(process.umask(), 0o022, 'do not change Host umask across an await');
      const stop = await pending; await stop();
      assert.equal(process.umask(), 0o022);
    `;
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--import', fileURLToPath(new URL('./watch-chmod.mjs', import.meta.url)),
        '--input-type=module', '-e', child, base, root], { timeout: 10000 });
    const observed = /SOCKET_MODE_BEFORE_CHMOD=(\S+)/.exec(stdout)?.[1];
    assert.ok(observed && observed !== 'never-called');
    assert.equal(observed, '700', `socket existed with group/other bits (0o${observed}) before chmod`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('failed socket binding restores the Host umask on both error paths', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sockfail-'));
  try {
    fs.chmodSync(dir, 0o700);
    const child = `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      const { start } = await import(${JSON.stringify(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)))});
      process.umask(0o022);
      net.Server.prototype.listen = function () { throw Error('synthetic_bind_failure'); };
      await assert.rejects(start({}, process.argv[1]), /synthetic_bind_failure/);
      assert.equal(process.umask(), 0o022);
      net.Server.prototype.listen = function () {
        process.nextTick(() => this.emit('error', Error('synthetic_async_bind_failure')));
        return this;
      };
      const pending = start({}, process.argv[1]);
      assert.equal(process.umask(), 0o022);
      await assert.rejects(pending, /synthetic_async_bind_failure/);
      assert.equal(process.umask(), 0o022);
    `;
    await promisify(execFile)(process.execPath,
      ['--input-type=module', '-e', child, path.join(dir, 'state')], { timeout: 10000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
