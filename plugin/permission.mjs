// Called only inside a fresh bridge create, before its first prompt. No wire operation exposes this.
export function setNewSessionPermission(ctx, sessionId, signal) {
  signal?.throwIfAborted();
  const agent = ctx.agents.get(sessionId);
  const service = agent?.ctx?.get?.('permissionPresets') ?? ctx.get?.('permissionPresets');
  if (!agent?.session || agent.session.id !== sessionId || agent.status === 'running' ||
      !service?.resolve || !service?.set || !service?.current || !service?.permissionState) {
    throw Error('dsh_permission_unavailable');
  }
  const preset = 'danger-full-access', spec = service.resolve(preset);
  if (spec.sandbox !== preset || spec.approval !== 'never') throw Error('dsh_permission_unavailable');
  signal?.throwIfAborted();
  service.set(agent.session, preset);
  const state = service.permissionState(agent.session);
  if (service.current(agent.session) !== preset || state.sandbox !== preset || state.approval !== 'never') {
    throw Error('dsh_permission_verification_failed');
  }
  return { preset, sandbox: state.sandbox, approval: state.approval, verified: true };
}
