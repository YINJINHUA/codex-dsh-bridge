import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register, projectConfig } from '../lib/config.mjs';

export const uuidA = '00000000-0000-4000-8000-000000000001';
export const uuidB = '00000000-0000-4000-8000-000000000002';
export const sidA = 'session-' + uuidA, sidB = 'session-' + uuidB;
export function fixture() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bridge-'));
  fs.chmodSync(dir, 0o700);
  const base = path.join(dir, 'state');
  const a = fs.mkdirSync(path.join(dir, 'alpha'), { recursive: true });
  const b = fs.mkdirSync(path.join(dir, 'beta'), { recursive: true });
  register(base, 'alpha', [a]); register(base, 'beta', [b]);
  const calls = [], members = new Map([[a, [sidA]], [b, [sidB]]]);
  const ctx = {
    workspaceRegistry: { async resolveByPath(root) { return { sessionIds: members.get(root) || [] }; } },
    agents: { get() { return { status: 'idle' }; } },
    sessionController: {
      async prompt(req) { calls.push(req); return { accepted: true }; },
      async projections(req) { calls.push(['read', req]); return { asOfSeq: 5 }; },
      async page() { return { records: [], hasMore: true }; }
    }
  };
  function req(op = 'send', project = 'alpha', session = sidA, id = 'test-1') {
    return { op, project, session, id, revision: projectConfig(base, project).revision,
      ...(op === 'send' ? { text: 'synthetic communication' } : {}) };
  }
  return { dir, base, a, b, ctx, calls, members, req, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function fakeCodex(f) {
  const file = path.join(f.dir, 'fake-codex.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
if (process.argv[2] === 'queue') {
  fs.appendFileSync(process.env.TEST_QUEUE, JSON.stringify(process.argv.slice(2))+'\\n');
  process.exit(process.env.TEST_FAIL ? 1 : 0);
}
if (process.env.TEST_SILENT) { setTimeout(()=>process.exit(0), 20000); }
else {
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{
  const m=JSON.parse(line);
  if(m.id===1) console.log(JSON.stringify({id:1,result:{userAgent:'test'}}));
  if(m.id===2) console.log(JSON.stringify({id:2,result:{thread:{id:m.params.threadId,cwd:process.env.TEST_ROOT,status:{type:'notLoaded'}}}}));
});
}
`);
  fs.chmodSync(file, 0o700);
  return file;
}
