import { safeError } from '../lib/errors.mjs';
import net from 'node:net';
import fs from 'node:fs';
import { isMainThread } from 'node:worker_threads';
import { home, socketPath } from '../lib/config.mjs';
import { handle, validate } from './core.mjs';
import { isWindows } from '../lib/windows.mjs';
import { channelKey, serverChannel } from '../lib/secure-channel.mjs';
import { startWorker } from './worker-host.mjs';
import { setNewSessionPermission } from './permission.mjs';
const channels = new WeakMap();

export const name = 'codex-project-local-bridge';
export const inject = ['sessionController', 'agents', 'workspaceRegistry'];

export function start(ctx, base = home(), limits = {}) {
  if (!limits.inWorker && (isWindows || limits.worker)) return startWorker(ctx, base, limits);
  // Cordis Context rejects unknown service properties. Keep the Worker-only adapter on a plain object.
  const host = ctx;
  ctx = { workspaceRegistry: ctx.workspaceRegistry, sessionController: ctx.sessionController,
    agents: ctx.agents, logger: ctx.logger, bridgePage: limits.inWorker ? ctx.bridgePage : null,
    bridgePermission: limits.inWorker ? ctx.bridgePermission : (id, signal) => setNewSessionPermission(host, id, signal) };
  const endpoint = socketPath(base);
  if (!isWindows) {
    try { fs.lstatSync(endpoint); throw Error('socket_exists'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const clients = new Set(), active = new Set(), unsettled = new Set(), controllers = new Set(), jobs = new Set();
  const state = { clients, active, unsettled, controllers, jobs, ctx, base,
    key: isWindows ? channelKey(base, true) : limits.channelKey,
    readMs: limits.readMs ?? 15000, requestMs: limits.requestMs ?? (isWindows ? 60000 : 10000) };
  const server = net.createServer(client => {
    try { accept(client, state); } catch { client.destroy(); }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // Unix bind is synchronous; never keep a process-wide umask across callbacks.
    const previousUmask = isWindows || !isMainThread ? null : process.umask(0o077);
    try { server.listen(endpoint, () => {
      try { if (!isWindows) fs.chmodSync(endpoint, 0o600); }
      catch (error) { server.close(); reject(error); return; }
      resolve(async () => {
        for (const controller of controllers) controller.abort();
        for (const client of clients) client.destroy();
        await new Promise(done => server.close(done));
        await Promise.allSettled([...jobs]);
      });
    }); } finally { if (previousUmask !== null) process.umask(previousUmask); }
  });
}

function accept(client, state) {
  const { clients, active, unsettled, readMs } = state;
  if (clients.size >= 32) return client.destroy();
  clients.add(client);
  const timer = setTimeout(() => client.destroy(), readMs);
  client.on('close', () => { clients.delete(client); clearTimeout(timer); });
  client.on('error', () => {});
  if (state.key) {
    const channel = serverChannel(state.key); channels.set(client, channel);
    client.write(JSON.stringify(channel.hello) + '\n');
  }
  let raw = Buffer.alloc(0), started = false;
  client.on('data', chunk => {
    if (started) return client.destroy();
    raw = Buffer.concat([raw, chunk]);
    if (raw.length > (state.key ? 98304 : 65536)) return client.destroy();
    if (!raw.includes(10)) return;
    started = true;
    clearTimeout(timer);
    let req;
    try {
      req = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (state.key) req = channels.get(client).open(req, 'request');
      validate(req);
    }
    catch { return respond(client, { ok: false, error: 'invalid_request' }); }
    const lock = (req.target === 'codex' ? 'codex/' : 'dsh/') +
      (req.op === 'create' ? 'create/' + req.project + '/' + req.id : req.session);
    if (unsettled.has(lock)) return respond(client, { ok: false, error: 'host_request_unsettled' });
    if (active.has(lock)) return respond(client, { ok: false, error: 'session_busy' });
    if (active.size >= 16) return respond(client, { ok: false,
      error: unsettled.size ? 'host_capacity_unsettled' : 'bridge_busy' });
    dispatch(client, req, state, lock);
  });
}

function dispatch(client, req, { active, unsettled, controllers, jobs, ctx, base, requestMs }, lock) {
  active.add(lock);
  const controller = new AbortController(); controllers.add(controller);
  const cancel = () => controller.abort(); client.once('close', cancel);
  const timer = setTimeout(() => {
    unsettled.add(lock);
    controller.abort(); respond(client, { ok: false, error: 'request_timeout_delivery_unknown' });
    ctx.logger?.warn?.('Bridge Host request remains unsettled after timeout; delivery may be unknown. No automatic reset.');
  }, req.target === 'codex' ? Math.max(requestMs, req.op === 'create' ? 210000 : 60000) :
    req.op === 'create' ? Math.max(requestMs, 60000) : requestMs);
  const job = handle(ctx, req, base, controller.signal).then(value => {
      respond(client, { ok: true, requestId: req.id, project: req.project, value });
    }, error => {
      respond(client, { ok: false, error: safeError(error) });
    }).finally(() => {
      clearTimeout(timer); client.removeListener('close', cancel);
      active.delete(lock); unsettled.delete(lock); controllers.delete(controller);
      jobs.delete(job);
    });
    // Owned Codex subprocesses settle on cancellation; unrelated Host calls may ignore it forever.
    if (req.target === 'codex') jobs.add(job);
}

export function respond(client, value) {
  try {
  if (client.destroyed || client.writableEnded) return;
  let wire = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(wire) > 65536) wire = '{"ok":false,"error":"response_too_large"}\n';
  const channel = channels.get(client);
  if (channel) wire = JSON.stringify(channel.seal(JSON.parse(wire), 'response')) + '\n';
  // Drain the response before closing, but bound clients that stop reading.
  const deadline = setTimeout(() => client.destroy(), 5000); deadline.unref();
  client.once('close', () => clearTimeout(deadline));
  client.end(wire);
  client.destroySoon();
  } catch { client.destroy(); }
}

export function apply(ctx) {
  ctx.effect(() => Promise.resolve().then(() => start(ctx)).catch(error => {
    // A broken optional bridge must not bring down the Desktop Host or other plugins.
    ctx.logger?.warn?.(`Project bridge unavailable (${safeError(error)}); run node scripts/doctor.mjs from the installed plugin directory. No automatic reset.`);
    return () => {};
  }));
}
