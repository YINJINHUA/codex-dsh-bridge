import { fixture, sidA } from './helpers.mjs';
import { projectConfig } from '../lib/config.mjs';
import { setNewSessionPermission } from '../plugin/permission.mjs';
import { start } from '../plugin/index.mjs';

export function setup(t) {
  const f = fixture(); let stop;
  t.after(async () => { if (stop) await stop(); f.cleanup(); });
  const sessions = new Map([[sidA, { id: sidA }]]), states = new Map(), applied = [];
  const service = {
    resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
    set(session, preset) { applied.push(session.id); states.set(session.id, { preset, sandbox: preset, approval: 'never' }); },
    current: session => states.get(session.id)?.preset,
    permissionState: session => states.get(session.id) ?? {}
  };
  f.ctx.get = name => name === 'permissionPresets' ? service : undefined;
  f.ctx.agents.get = id => sessions.has(id) ? { session: sessions.get(id), status: 'idle' } : undefined;
  f.ctx.workspaceRegistry.resolveByPath = async root => ({ id: 'workspace', sessionIds: f.members.get(root) || [] });
  f.ctx.sessionController.create = async ({ sessionId }) => {
    sessions.set(sessionId, { id: sessionId }); f.members.get(f.a).push(sessionId); return { sessionId };
  };
  f.ctx.sessionController.rename = async () => {};
  f.ctx.bridgePermission = (id, signal) => setNewSessionPermission(f.ctx, id, signal);
  const req = { op: 'create', project: 'alpha', id: 'policy-create', revision: projectConfig(f.base, 'alpha').revision,
    root: f.a, title: 'Permission test', text: 'Synthetic authorized task.' };
  return { ...f, req, service, sessions, states, applied,
    async listen(worker) { stop = await start(f.ctx, f.base, { worker }); } };
}

