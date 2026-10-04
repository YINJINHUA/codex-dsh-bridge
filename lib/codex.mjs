import { spawn } from 'node:child_process';
import { rootPath, uuid, claim, digest, finish, projectConfig, slug, validId } from './config.mjs';
import { resolveBinary, afterOwnedClose, queueOnce } from './process.mjs';

// A short-lived metadata reader uses only initialize + thread/read(includeTurns:false).
// It never resumes/creates an Agent or starts a model turn; queue handles delivery.
export function readThread(binary, thread, { timeoutMs = 12000, signal, name, roots, beforeRename } = {}) {
  if (!uuid(thread)) throw Error('invalid_session');
  signal?.throwIfAborted();
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120 ||
      !name.isWellFormed() || name.includes('\0') || !Array.isArray(roots))) throw Error('invalid_title');
  binary = resolveBinary(binary);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let raw = '', size = 0, done = false, stage = 0;
    const timer = setTimeout(() => end(Error('codex_timeout')), timeoutMs);
    function end(error, value) {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      afterOwnedClose(child, () => error ? reject(error) : resolve(value));
    }
    function send(message) { child.stdin.write(JSON.stringify(message) + '\n'); }
    const abort = () => end(Error('codex_cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => end(Error('codex_unavailable')));
    child.on('exit', () => end(Error('codex_disconnected')));
    child.stdin.on('error', () => end(Error('codex_disconnected')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 1048576) return end(Error('codex_response_too_large'));
      raw += chunk.toString('utf8');
      while (raw.includes('\n') && !done) {
        const at = raw.indexOf('\n'), line = raw.slice(0, at); raw = raw.slice(at + 1);
        try { receive(JSON.parse(line)); } catch { end(Error('codex_invalid_response')); }
      }
    });
    function receive(msg) {
      if (msg.id === 1) {
        if (stage !== 0) return end(Error('codex_invalid_response'));
        if (msg.error || !msg.result) return end(Error('codex_initialize_failed'));
        stage = 1;
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'thread/read', params: { threadId: thread, includeTurns: false } });
      } else if (msg.id === 2 || msg.id === 4) {
        if (stage !== (msg.id === 2 ? 1 : 3)) return end(Error('codex_invalid_response'));
        if (msg.error || msg.result?.thread?.id !== thread) return end(Error('codex_thread_unavailable'));
        const t = msg.result.thread;
        if (name !== undefined) {
          if (!roots.includes(rootPath(t.cwd))) return end(Error('project_mismatch'));
          if (msg.id === 2) {
            beforeRename?.(); signal?.throwIfAborted(); stage = 2;
            send({ id: 3, method: 'thread/name/set', params: { threadId: thread, name } }); return;
          }
          if (t.name !== name) return end(Error('codex_title_not_applied'));
        }
        end(null, { id: t.id, cwd: t.cwd, status: typeof t.status?.type === 'string' ?
          { type: t.status.type.slice(0, 64) } : null, name: typeof t.name === 'string' ? t.name.slice(0, 120) : null,
          source: typeof t.source === 'string' ? t.source.slice(0, 32) : null });
      } else if (msg.id === 3) {
        if (stage !== 2 || msg.error || !msg.result) return end(Error('codex_title_not_applied'));
        stage = 3; send({ id: 4, method: 'thread/read', params: { threadId: thread, includeTurns: false } });
      }
    }
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'codex_dsh_project_bridge', version: '0.3.7' }
    } });
  });
}

export async function codexStatus(binary, thread, roots, options = {}) {
  const value = await readThread(binary, thread, options);
  if (!roots.includes(rootPath(value.cwd))) throw Error('project_mismatch');
  return { sessionId: thread, status: value.status, statusSource: 'metadata_reader_not_desktop_liveness',
    membershipVerified: true, title: value.name, source: value.source };
}

export async function codexSend(binary, req, cfg, base, { queueMs = 15000, signal } = {}) {
  if (!slug(req.project) || !validId(req.id) || !uuid(req.session) || typeof req.text !== 'string' ||
      !req.text.trim() || req.text.includes('\0') || !req.text.isWellFormed() || Buffer.byteLength(req.text) > 8192) {
    throw Error('invalid_request');
  }
  binary = resolveBinary(binary);
  await codexStatus(binary, req.session, cfg.roots, { signal });
  if (projectConfig(base, req.project).revision !== cfg.revision) throw Error('configuration_changed');
  signal?.throwIfAborted();
  const key = JSON.stringify(['codex', req.project, req.session, req.id]);
  const receipt = claim(base, key, digest(JSON.stringify([cfg.revision, req.text])));
  if (receipt.record.state === 'accepted') {
    if (receipt.record.value.sessionId !== req.session || receipt.record.value.requestId !== req.id) throw Error('invalid_receipt');
    return { ...receipt.record.value, duplicate: true };
  }
  if (!receipt.fresh) throw Error('delivery_unknown_no_retry');
  // Intent is durable BEFORE queue: a crash or timeout must not cause an automatic resend.
  const message = `[DSH/Codex代理消息，非用户新授权] project=${req.project}; request=${req.id}\n${req.text}`;
  try {
    await queueOnce(binary, ['queue', '--thread', req.session, '--message', message], queueMs);
  } catch { throw Error('delivery_unknown_no_retry'); }
  const value = { sessionId: req.session, requestId: req.id, accepted: true,
    delivery: 'queued_only', membershipVerified: true };
  finish(receipt.file, receipt.record, value);
  return value;
}
