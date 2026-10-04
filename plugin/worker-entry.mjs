import { parentPort, workerData } from 'node:worker_threads';
import { safeError } from '../lib/errors.mjs';
import { start } from './index.mjs';

let next = 0;
const pending = new Map();
function call(method, arg, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = ++next;
    const abort = () => parentPort.postMessage({ kind: 'abort', id });
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, { resolve, reject, signal, abort });
    parentPort.postMessage({ kind: 'call', id, method, arg });
  });
}
parentPort.on('message', message => {
  const entry = message.kind === 'reply' && pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id); entry.signal?.removeEventListener('abort', entry.abort);
  message.error ? entry.reject(Error(safeError(message.error, 'host_operation_failed'))) : entry.resolve(message.value);
});
const ctx = {
  workspaceRegistry: { resolveByPath: root => call('workspace', root) },
  agents: { get: session => call('agent', session) },
  sessionController: {
    create: (arg, signal) => call('create', arg, signal),
    rename: (arg, signal) => call('rename', arg, signal),
    projections: (arg, signal) => call('projection', arg, signal),
    prompt: (arg, signal) => call('prompt', arg, signal)
  },
  bridgePage: (arg, signal) => call('page', arg, signal),
  bridgePermission: (arg, signal) => call('permission', arg, signal)
};
try {
  const stop = await start(ctx, workerData.base, { ...workerData.limits, inWorker: true });
  parentPort.on('message', message => {
    if (message.kind === 'stop') void stop().finally(() => parentPort.postMessage({ kind: 'stopped' }));
  });
  parentPort.postMessage({ kind: 'ready' });
} catch (error) { parentPort.postMessage({ kind: 'failed', error: safeError(error) }); }
