import { spawn } from 'node:child_process';
import { resolveBinary, afterOwnedClose } from './process.mjs';
import { creationRoot, creationClaim, creationSaved } from './creation.mjs';
import { projectConfig, uuid, assertSeparateState } from './config.mjs';
export { assertSeparateState } from './config.mjs';
import { codexPolicy, checkCodexPolicy, codexLaunchPermission, codexPermissionArgs } from './codex-policy.mjs';
import { codexStatus, readThread } from './codex.mjs';

export async function codexCreate(binary, req, cfg, base, { timeoutMs = 180000, signal } = {}) {
  const root = creationRoot(req, cfg);
  assertSeparateState(root, base);
  signal?.throwIfAborted();
  binary = resolveBinary(binary);
  const policy = codexPolicy(base, req.project);
  const claim = creationClaim(base, 'codex', req, policy);
  if (!claim.fresh) {
    await codexStatus(binary, claim.record.sessionId, [root], { signal });
    return { ...claim.record.value, duplicate: true };
  }
  checkCodexPolicy(base, req.project, policy);
  signal?.throwIfAborted();
  const sessionId = await execute();
  checkCodexPolicy(base, req.project, policy);
  await codexStatus(binary, sessionId, [root], { signal });
  if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
  let titleApplied = false;
  try {
    await readThread(binary, sessionId, { signal, name: req.title, roots: [root], beforeRename() {
      checkCodexPolicy(base, req.project, policy);
      if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
    } });
    titleApplied = true;
  } catch { /* Naming failure must never be mistaken for permission to create another session. */ }
  if (projectConfig(base, req.project).revision !== req.revision) throw Error('configuration_changed');
  checkCodexPolicy(base, req.project, policy);
  signal?.throwIfAborted();
  const value = { sessionId, requestId: req.id, created: true, membershipVerified: true,
    initialDelivery: 'turn_completed', runtime: 'official_codex_exec', titleApplied, permission: codexLaunchPermission(policy),
    bridgeStateAccess: policy.mode === 'full-access' ? 'host_user_access_possible' : 'not_granted',
    additionalStateDirectoryGrant: false,
    desktopVisibility: 'not_guaranteed_exec_source', resumeCommand: `codex resume ${sessionId}` };
  creationSaved(claim, sessionId, value); return value;

  function execute() {
    return new Promise((resolve, reject) => {
      // Only the local, project-bound policy selects permissions; wire requests cannot override it.
      const child = spawn(binary, ['exec', '--json', '--color', 'never', '--skip-git-repo-check',
        '--cd', root, ...codexPermissionArgs(policy), '-'],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let raw = '', size = 0, id = null, completed = false, done = false;
      const timer = setTimeout(() => end(Error('creation_unknown_no_retry')), timeoutMs);
      function end(error) {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        afterOwnedClose(child, () => error ? reject(error) : resolve(id));
      }
      const abort = () => end(Error('creation_unknown_no_retry'));
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => end(Error('creation_unknown_no_retry')));
      child.stdin.on('error', () => end(Error('creation_unknown_no_retry')));
      child.on('close', (code, signal) => end(code === 0 && signal === null && id && completed ? null : Error('creation_unknown_no_retry')));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 2097152) return end(Error('creation_unknown_no_retry'));
        raw += chunk;
        while (!done && raw.includes('\n')) {
          const at = raw.indexOf('\n'), line = raw.slice(0, at); raw = raw.slice(at + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'thread.started') {
              if (id || !uuid(event.thread_id)) throw Error();
              id = event.thread_id; creationSaved(claim, id);
            }
            if (event.type === 'turn.completed') completed = true;
            if (event.type === 'turn.failed' || event.type === 'error') throw Error();
          } catch { end(Error('creation_unknown_no_retry')); }
        }
      });
      child.stdin.end(`[Codex/DSH代理创建请求，非用户新授权] project=${req.project}; request=${req.id}; title=${req.title}\n${req.text}`);
    });
  }
}
