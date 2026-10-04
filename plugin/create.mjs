import { randomUUID } from 'node:crypto';
import { projectConfig, digest, replaceJSON } from '../lib/config.mjs';
import { creationRoot, creationClaim, creationSaved, creationPrompt } from '../lib/creation.mjs';
import { membership } from './core.mjs';
import { dshPolicy, checkDshPolicy } from '../lib/dsh-policy.mjs';

export async function createSession(ctx, req, base, signal) {
  const cfg = projectConfig(base, req.project), root = creationRoot(req, cfg, { allowDshInherit: true });
  const policy = dshPolicy(base);
  const permissionMode = req.dshPermission ?? policy.newSessionPermission;
  const workspace = await ctx.workspaceRegistry.resolveByPath(root);
  if (!workspace || typeof workspace.id !== 'string' || !workspace.id) throw Error('workspace_not_found');
  if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
  signal?.throwIfAborted();
  const claim = creationClaim(base, 'dsh', req);
  if (!claim.fresh) {
    await membership(ctx, [root], claim.record.sessionId);
    return { ...claim.record.value, duplicate: true };
  }
  const sessionId = 'session-' + randomUUID();
  // Persist the planned identity BEFORE calling the Host. Never generate a replacement on retry.
  claim.record.sessionId = sessionId; replaceJSON(claim.file, claim.record);
  const result = await ctx.sessionController.create({ workspaceId: workspace.id, sessionId }, signal);
  if (result?.sessionId !== sessionId) throw Error('invalid_created_session');
  creationSaved(claim, sessionId);
  await membership(ctx, [root], sessionId);
  if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
  checkDshPolicy(base, policy);
  signal?.throwIfAborted();
  let permission = { requested: permissionMode, verified: false,
    ...(req.dshPermission === 'inherit' ? { source: 'dsh_default', overrideApplied: false } : {}) };
  if (permissionMode === 'full-access') {
    if (typeof ctx.bridgePermission !== 'function') throw Error('dsh_permission_unavailable');
    permission = { requested: 'full-access', ...await ctx.bridgePermission(sessionId, signal) };
    if (permission.preset !== 'danger-full-access' || permission.sandbox !== 'danger-full-access' ||
        permission.approval !== 'never' || permission.verified !== true) throw Error('dsh_permission_verification_failed');
  }
  await ctx.sessionController.rename({ sessionId, title: req.title }, signal);
  if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
  checkDshPolicy(base, policy);
  await membership(ctx, [root], sessionId);
  checkDshPolicy(base, policy);
  if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
  signal?.throwIfAborted();
  const hostRequestId = 'project-bridge-' + digest(JSON.stringify(['create', req.project, req.id]));
  const accepted = await ctx.sessionController.prompt({ sessionId, requestId: hostRequestId,
    mode: 'queue', content: [{ type: 'text', text: creationPrompt(req, sessionId) }] }, signal);
  if (accepted?.accepted !== true) throw Error('not_accepted');
  const value = { sessionId, requestId: req.id, hostRequestId, created: true,
    membershipVerified: true, initialDelivery: 'queued_only', permission };
  creationSaved(claim, sessionId, value);
  return value;
}
