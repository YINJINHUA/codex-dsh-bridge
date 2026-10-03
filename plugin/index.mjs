import net from 'node:net';
import fs from 'node:fs';
import { home, socketPath } from '../lib/config.mjs';
import { handle, validate } from './core.mjs';

export const name = 'codex-project-local-bridge';
export const inject = ['sessionController', 'agents', 'workspaceRegistry'];
const errors = new Set(['invalid_request', 'unknown_field', 'invalid_text', 'project_mismatch',
  'configuration_changed', 'request_id_conflict', 'session_not_found', 'not_accepted',
  'unsafe_file', 'unsafe_directory', 'invalid_config', 'root_changed_reregister', 'invalid_receipt',
  'config_version_unsupported_reregister', 'unknown_project', 'request_timeout_delivery_unknown']);

export function start(ctx, base = home(), limits = {}) {
  const endpoint = socketPath(base);
  try { fs.lstatSync(endpoint); throw Error('socket_exists'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const clients = new Set(), active = new Set(), unsettled = new Set(), controllers = new Set();
  const state = { clients, active, unsettled, controllers, ctx, base,
    readMs: limits.readMs ?? 15000, requestMs: limits.requestMs ?? 10000 };
  const server = net.createServer(client => accept(client, state));
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // Unix bind is synchronous; never keep a process-wide umask across callbacks.
    const previousUmask = process.umask(0o077);
    try { server.listen(endpoint, () => {
      try { fs.chmodSync(endpoint, 0o600); }
      catch (error) { server.close(); reject(error); return; }
      resolve(() => new Promise(done => {
        for (const controller of controllers) controller.abort();
        for (const client of clients) client.destroy();
        server.close(done);
      }));
    }); } finally { process.umask(previousUmask); }
  });
}

function accept(client, state) {
  const { clients, active, unsettled, readMs } = state;
  if (clients.size >= 32) return client.destroy();
  clients.add(client);
  const timer = setTimeout(() => client.destroy(), readMs);
  client.on('close', () => { clients.delete(client); clearTimeout(timer); });
  client.on('error', () => {});
  let raw = Buffer.alloc(0), started = false;
  client.on('data', chunk => {
    if (started) return client.destroy();
    raw = Buffer.concat([raw, chunk]);
    if (raw.length > 65536) return client.destroy();
    if (!raw.includes(10)) return;
    started = true;
    clearTimeout(timer);
    let req;
    try { req = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); validate(req); }
    catch { return respond(client, { ok: false, error: 'invalid_request' }); }
    if (unsettled.has(req.session)) return respond(client, { ok: false, error: 'host_request_unsettled' });
    if (active.has(req.session)) return respond(client, { ok: false, error: 'session_busy' });
    if (active.size >= 16) return respond(client, { ok: false,
      error: unsettled.size ? 'host_capacity_unsettled' : 'bridge_busy' });
    dispatch(client, req, state);
  });
}

function dispatch(client, req, { active, unsettled, controllers, ctx, base, requestMs }) {
  active.add(req.session);
  const controller = new AbortController(); controllers.add(controller);
  const cancel = () => controller.abort(); client.once('close', cancel);
  const timer = setTimeout(() => {
    unsettled.add(req.session);
    controller.abort(); respond(client, { ok: false, error: 'request_timeout_delivery_unknown' });
    client.destroy();
    ctx.logger?.warn?.('Bridge Host request remains unsettled after timeout; delivery may be unknown. No automatic reset.');
  }, requestMs);
  handle(ctx, req, base, controller.signal).then(value => {
      respond(client, { ok: true, requestId: req.id, project: req.project, value });
    }, error => {
      respond(client, { ok: false, error: errors.has(error.message) ? error.message : 'bridge_error' });
    }).finally(() => {
      clearTimeout(timer); client.removeListener('close', cancel);
      active.delete(req.session); unsettled.delete(req.session); controllers.delete(controller);
    });
}

function respond(client, value) {
  if (client.destroyed || client.writableEnded) return;
  let wire = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(wire) > 65536) wire = '{"ok":false,"error":"response_too_large"}\n';
  client.end(wire);
}

export function apply(ctx) {
  ctx.effect(() => Promise.resolve().then(() => start(ctx)).catch(() => {
    // A broken optional bridge must not bring down the Desktop Host or other plugins.
    ctx.logger?.warn?.('Project bridge unavailable; check its private directory and socket. No automatic reset.');
    return () => {};
  }));
}
