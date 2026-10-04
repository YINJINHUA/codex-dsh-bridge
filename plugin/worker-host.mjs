import { safeError } from '../lib/errors.mjs';
import { Worker } from 'node:worker_threads';
import { summarize } from './core.mjs';
import { setNewSessionPermission } from './permission.mjs';

// Slow OS permission checks run outside the Desktop Host event loop. Host services stay here.
export function startWorker(ctx, base, limits) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker-entry.mjs', import.meta.url), { workerData: { base, limits } });
    const calls = new Map();
    let stoppedAck;
    const acknowledged = new Promise(resolve => { stoppedAck = resolve; });
    let ready = false, stopped = false;
    const stop = async () => {
      stopped = true;
      for (const controller of calls.values()) controller.abort();
      worker.postMessage({ kind: 'stop' });
      let timer;
      await Promise.race([acknowledged, new Promise(resolve => { timer = setTimeout(resolve, 20000); })]);
      clearTimeout(timer);
      await worker.terminate();
    };
    const startup = setTimeout(() => { reject(Error('bridge_startup_timeout')); void stop(); }, 90000);
    worker.on('error', () => { clearTimeout(startup); reject(Error('bridge_worker_failed')); });
    worker.on('exit', () => {
      stoppedAck();
      clearTimeout(startup);
      for (const controller of calls.values()) controller.abort();
      if (!ready) reject(Error('bridge_worker_failed'));
      else if (!stopped) ctx.logger?.warn?.('Bridge worker stopped. No automatic restart; reconcile uncertain delivery before restarting.');
      stopped = true;
    });
    worker.on('message', async message => {
      if (message.kind === 'stopped') { stoppedAck(); return; }
      if (stopped) return;
      if (message.kind === 'ready') { ready = true; clearTimeout(startup); resolve(stop); return; }
      if (message.kind === 'failed') {
        clearTimeout(startup); stopped = true;
        reject(Error(safeError(message.error, 'bridge_worker_failed'))); void worker.terminate(); return;
      }
      if (message.kind === 'abort') { calls.get(message.id)?.abort(); return; }
      if (message.kind !== 'call' || calls.size >= 16) return;
      const controller = new AbortController(); calls.set(message.id, controller);
      try {
        let value;
        switch (message.method) {
          case 'workspace': {
            const result = await ctx.workspaceRegistry.resolveByPath(message.arg);
            value = { id: result?.id, sessionIds: result ? [...result.sessionIds] : [] }; break;
          }
          case 'agent': {
            const agent = ctx.agents.get(message.arg);
            value = agent ? { status: String(agent.status ?? 'not_loaded').slice(0, 64) } : null; break;
          }
          case 'projection': {
            const projection = await ctx.sessionController.projections(message.arg, controller.signal);
            value = projection ? { asOfSeq: projection.asOfSeq } : null; break;
          }
          case 'page': {
            const page = await ctx.sessionController.page(message.arg, controller.signal);
            value = { latestTurn: summarize(page.records), hasMore: page.hasMore }; break;
          }
          case 'prompt': {
            const result = await ctx.sessionController.prompt(message.arg, controller.signal);
            value = { accepted: result.accepted === true }; break;
          }
          case 'create': {
            const result = await ctx.sessionController.create(message.arg);
            value = { sessionId: result.sessionId }; break;
          }
          case 'rename': {
            await ctx.sessionController.rename(message.arg);
            value = { renamed: true }; break;
          }
          case 'permission': {
            value = setNewSessionPermission(ctx, message.arg, controller.signal); break;
          }
          default: throw Error('invalid_host_operation');
        }
        if (!stopped) worker.postMessage({ kind: 'reply', id: message.id, value });
      } catch (error) {
        if (!stopped) worker.postMessage({ kind: 'reply', id: message.id, error: safeError(error, 'host_operation_failed') });
      } finally { calls.delete(message.id); }
    });
  });
}
