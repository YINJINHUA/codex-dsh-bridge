import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { register, projectConfig, privateDir } from '../lib/config.mjs';

export const uuidA = '00000000-0000-4000-8000-000000000001';
export const uuidB = '00000000-0000-4000-8000-000000000002';
export const sidA = 'session-' + uuidA, sidB = 'session-' + uuidB;
export function windowsScript(script, input) {
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, windowsHide: true,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath')),
        PSModulePath: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') } });
  if (result.error || result.status !== 0) throw Error('test_windows_helper_failed');
  return result.stdout;
}
export function fixture() {
  const dir = process.platform === 'win32' ? privateDir(path.join(fs.realpathSync.native(os.tmpdir()), 'bridge-' + randomUUID())) :
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bridge-'));
  fs.chmodSync(dir, 0o700);
  const base = path.join(dir, 'state');
  const a = path.join(dir, 'alpha'), b = path.join(dir, 'beta');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
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
  if (process.platform === 'win32') {
    const output = path.join(f.dir, 'fake-codex.exe');
    const source = fileURLToPath(new URL('./fake-codex.cs', import.meta.url));
    const script = `[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -Path $r.source -OutputAssembly $r.output -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions -ErrorAction Stop`;
    windowsScript(script, { source, output });
    return output;
  }
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
let name = null;
rl.on('line',line=>{
  const m=JSON.parse(line);
  if(m.id===1) console.log(JSON.stringify({id:1,result:{userAgent:'test'}}));
  if(m.id===2 || m.id===4) console.log(JSON.stringify({id:m.id,result:{thread:{id:m.params.threadId,cwd:process.env.TEST_ROOT,name,source:'exec',status:{type:'notLoaded'}}}}));
  if(m.id===3) { name=m.params.name; console.log(JSON.stringify({id:3,result:{}})); }
});
}
`);
  fs.chmodSync(file, 0o700);
  return file;
}
