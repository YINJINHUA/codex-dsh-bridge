import { projectConfig, validId, uuid, slug, claim, digest, finish } from '../lib/config.mjs';
import { validateCreate } from '../lib/creation.mjs';
import { createSession } from './create.mjs';
import { validateCodex, handleCodex } from '../lib/codex-host.mjs';

export function validate(req) {
  if (req?.target === 'codex') return validateCodex(req);
  if (req?.op === 'create') return validateCreate(req, { allowDshInherit: true });
  if (!req || Array.isArray(req) || typeof req !== 'object') throw Error('invalid_request');
  const allowed = ['op', 'id', 'project', 'session', 'revision', ...(req.op === 'send' ? ['text'] : [])];
  if (Object.keys(req).some(k => !allowed.includes(k))) throw Error('unknown_field');
  if (!['send', 'status', 'result'].includes(req.op) || !validId(req.id) || !slug(req.project) ||
      typeof req.session !== 'string' || !req.session.startsWith('session-') || !uuid(req.session.slice(8)) ||
      typeof req.revision !== 'string' || req.revision.length !== 64 || /[^0-9a-f]/.test(req.revision)) throw Error('invalid_request');
  if (req.op === 'send' && (typeof req.text !== 'string' || !req.text.trim() ||
      !req.text.isWellFormed() || req.text.includes('\0') || Buffer.byteLength(req.text) > 8192)) throw Error('invalid_text');
}

export async function membership(ctx, roots, session) {
  for (const root of roots) {
    const workspace = await ctx.workspaceRegistry.resolveByPath(root);
    // DSH's sessionIds getter validates membership against stored canonical cwd.
    if (workspace?.sessionIds.includes(session)) return;
  }
  throw Error('project_mismatch');
}

export function summarize(records) {
  let latest = null;
  if (!Array.isArray(records)) throw Error('invalid_host_response');
  for (const record of records.slice(-10000)) {
    const e = record.type === 'event' ? record.event : null;
    if (!e) continue;
    if (e.type === 'turn/start') latest = { startSeq: e.seq, endSeq: null, reason: null,
      requestIds: [], requestIdsTruncated: false, text: '', truncated: false };
    if (!latest) continue;
    if (e.type === 'user/message' && e.data?.source?.kind === 'user' && typeof e.data.source.rpcId === 'string') {
      if (latest.requestIds.length < 64 && e.data.source.rpcId.length <= 128) latest.requestIds.push(e.data.source.rpcId);
      else latest.requestIdsTruncated = true;
    }
    if (e.type === 'assistant/message') {
      Object.assign(latest, boundedText(e.data?.message?.content ?? []));
    }
    if (e.type === 'turn/end') {
      latest.endSeq = e.seq;
      latest.reason = typeof e.data?.reason?.kind === 'string' ? e.data.reason.kind.slice(0, 64) : null;
    }
  }
  return latest;
}

function boundedText(content) {
  let text = '', truncated = false, remaining = 16384;
  if (!Array.isArray(content)) throw Error('invalid_host_response');
  for (const block of content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    if (!remaining) { if (block.text.length) truncated = true; continue; }
    let chunk = block.text.slice(0, remaining);
    if (chunk.length < block.text.length) truncated = true;
    // Bound allocation before measuring/encoding a potentially enormous Host fragment.
    let output = '';
    for (const cp of chunk) {
      const bytes = Buffer.byteLength(cp);
      if (bytes > remaining || !cp.isWellFormed()) { truncated = true; break; }
      output += cp; remaining -= bytes;
    }
    text += output;
    if (truncated) break;
  }
  return { text, truncated };
}

export async function handle(ctx, req, base, signal) {
  validate(req);
  if (req.target === 'codex') return handleCodex(req, base, signal);
  if (req.op === 'create') return createSession(ctx, req, base, signal);
  const cfg = projectConfig(base, req.project);
  if (cfg.revision !== req.revision) throw Error('configuration_changed');
  await membership(ctx, cfg.roots, req.session);
  if (projectConfig(base, req.project).revision !== cfg.revision) throw Error('configuration_changed');
  signal?.throwIfAborted();
  if (req.op === 'send') return send(ctx, req, cfg, base, signal);
  const projection = await ctx.sessionController.projections({ sessionId: req.session }, signal);
  if (!projection) throw Error('session_not_found');
  const agent = await ctx.agents.get(req.session);
  const value = { sessionId: req.session, membershipVerified: true, observedAt: new Date().toISOString(),
    asOfSeq: projection.asOfSeq, loaded: !!agent, runtimeStatus: String(agent?.status ?? 'not_loaded').slice(0, 64) };
  if (req.op === 'status') {
    if (projectConfig(base, req.project).revision !== cfg.revision) throw Error('configuration_changed');
    await membership(ctx, cfg.roots, req.session); signal?.throwIfAborted();
    return value;
  }
  const pageRequest = { address: { kind: 'session', sessionId: req.session },
    throughSeq: projection.asOfSeq, maxMessages: 8, turnWindow: { minMessages: 1, minTurns: 1 } };
  const page = ctx.bridgePage ? await ctx.bridgePage(pageRequest, signal) :
    await ctx.sessionController.page(pageRequest, signal);
  if (projectConfig(base, req.project).revision !== cfg.revision) throw Error('configuration_changed');
  await membership(ctx, cfg.roots, req.session);
  signal?.throwIfAborted();
  return { ...value, latestTurn: ctx.bridgePage ? page.latestTurn : summarize(page.records), olderHistoryOmitted: page.hasMore };
}

async function send(ctx, req, cfg, base, signal) {
  const key = JSON.stringify(['dsh', req.project, req.session, req.id]);
  const receipt = claim(base, key, digest(JSON.stringify([cfg.revision, req.text])));
  const hostRequestId = 'project-bridge-' + digest(key);
  if (receipt.record.state === 'accepted') {
    const value = receipt.record.value;
    if (value.sessionId !== req.session || value.requestId !== req.id || value.hostRequestId !== hostRequestId) {
      throw Error('invalid_receipt');
    }
    return { ...value, duplicate: true };
  }
  const message = `[Codex/DSH代理消息，非用户新授权] project=${req.project}; request=${req.id}\n${req.text}`;
  const result = await ctx.sessionController.prompt({ sessionId: req.session, requestId: hostRequestId,
    content: [{ type: 'text', text: message }], mode: 'followup' }, signal);
  if (result.accepted !== true) throw Error('not_accepted');
  const value = { sessionId: req.session, requestId: req.id, hostRequestId, accepted: true,
    delivery: 'queued_only', membershipVerified: true };
  finish(receipt.file, receipt.record, value);
  return value;
}
