#!/usr/bin/env node
import fs from 'node:fs';
import { readBounded } from '../lib/read.mjs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { home, projectConfig, projectFile, register, readJSON, validId, slug, syncDir } from '../lib/config.mjs';
import { exchange } from '../lib/transport.mjs';
import { codexStatus, codexSend } from '../lib/codex.mjs';
import { validate } from '../plugin/core.mjs';
import { codexCreate } from '../lib/codex-create.mjs';
import { rootPath } from '../lib/config.mjs';
import { configureCodex } from '../lib/codex-host.mjs';
import { configureCodexCreation, codexPolicy } from '../lib/codex-policy.mjs';
import { configureDsh } from '../lib/dsh-policy.mjs';

const help = `Codex ↔ DSH 项目通信桥 0.4.1
本机首次启用 Codex 宿主转发（在可信终端设置一次）：
  configure-codex --binary /absolute/path/to/codex
仅本插件新建 DSH 对话的权限（本机显式设置，不改全局/已有对话）：
  configure-dsh --new-session-permission inherit|full-access
full-access 会关闭新对话的 shell 沙箱及命令审批；默认 inherit 使用 DSH 默认权限。
仅本插件新建 Codex 对话的项目权限（默认 workspace-write）：
  configure-codex-creation --project NAME --new-session-permission workspace-write|full-access
  codex-creation-policy --project NAME
full-access 请求 danger-full-access 与 approval_policy=never，仅影响该项目未来新建 Codex。
在已登记项目内创建新对话并提交首条提示：
  create --project NAME --to dsh|codex --request-id UNIQUE --title TITLE --text-file FILE [--root ROOT]
仅创建 DSH 时可加 --dsh-permission inherit，跳过桥的完全权限覆盖，使用 DSH 新会话默认权限。
登记项目（只需一次，无需登记对话；多个 checkout 可重复 --root）：
  register --project NAME --root /absolute/workspace [--root /absolute/worktree]
查看或撤销登记：
  projects
  unregister --project NAME
向已登记项目内的任意现有对话发送消息：
  send --project NAME --to dsh|codex --session ID --request-id UNIQUE --text-file FILE
只读查询：
  status --project NAME --to dsh|codex --session ID
  result --project NAME --to dsh --session ID
Codex 方向默认经 DSH 宿主执行；--via direct 显式使用原直接 CLI 路线，无自动回退。
direct 模式从 PATH 或 CODEX_DSH_CODEX 指定的可信绝对路径发现 Codex CLI。
本机登记默认放在 macOS/Linux 的 ~/.codex-dsh-bridge 或 Windows 的 %USERPROFILE%\\.codex-dsh-bridge，DSH 插件与 CLI 必须使用同一目录。
退出 0 是查询/入队成功，不是任务完成。超时不要换编号盲目重发。
DSH 同工作区内部消息另装 dsh-xsession，在 DSH 对话中调用 xsession_* 工具；不是本 CLI 子命令。
跨项目对话需另选插件；本桥不会替 xsession 放宽工作区限制。
注册不会创建 DSH/Codex 项目。完整说明见 README.md。`;

export function parse(argv) {
  return parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    project: { type: 'string' }, root: { type: 'string', multiple: true },
    title: { type: 'string' },
    'new-session-permission': { type: 'string' },
    'dsh-permission': { type: 'string' },
    binary: { type: 'string' }, via: { type: 'string' },
    to: { type: 'string' }, session: { type: 'string' },
    'request-id': { type: 'string' }, 'text-file': { type: 'string' }
  } });
}

function readText(file) {
  if (!file) throw Error('text_file_required');
  if (process.platform === 'win32' && !fs.lstatSync(file).isFile()) throw Error('invalid_text_file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192) throw Error('invalid_text_file');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readBounded(fd, 8192, 'invalid_text'));
    if (!text.trim() || Buffer.byteLength(text) > 8192) throw Error('invalid_text');
    return text;
  } finally { fs.closeSync(fd); }
}

function allowedOptions(values, keys) {
  if (Object.keys(values).some(k => !keys.includes(k))) throw Error('unexpected_option');
}

async function execute(command, v, base) {
  if (command === 'help') { allowedOptions(v, []); console.log(help); return null; }
  if (command === 'configure-codex') {
    allowedOptions(v, ['binary']);
    if (!v.binary) throw Error('codex_binary_required');
    return configureCodex(base, v.binary);
  }
  if (command === 'configure-dsh') {
    allowedOptions(v, ['new-session-permission']);
    return configureDsh(base, v['new-session-permission']);
  }
  if (command === 'configure-codex-creation') {
    allowedOptions(v, ['project', 'new-session-permission']);
    return configureCodexCreation(base, v.project, v['new-session-permission']);
  }
  if (command === 'codex-creation-policy') {
    allowedOptions(v, ['project']);
    return { project: v.project, ...codexPolicy(base, v.project) };
  }
  if (command === 'projects') {
    allowedOptions(v, []);
    if (!fs.existsSync(path.join(base, 'projects'))) return { projects: [] };
    const projects = fs.readdirSync(path.dirname(projectFile(base, 'probe')))
      .filter(n => n.endsWith('.json') && slug(n.slice(0, -5))).map(n => n.slice(0, -5));
    return { projects: projects.map(name => ({ name, ...projectConfig(base, name) })) };
  }
  if (command === 'register') {
    allowedOptions(v, ['project', 'root']);
    return register(base, v.project, v.root ?? []);
  }
  if (command === 'unregister') {
    allowedOptions(v, ['project']);
    const file = projectFile(base, v.project); readJSON(file); fs.unlinkSync(file);
    syncDir(path.dirname(file));
    return { unregistered: v.project, conversationsUnchanged: true };
  }
  if (command === 'create') {
    allowedOptions(v, ['project', 'to', 'request-id', 'title', 'text-file', 'root', 'via', 'dsh-permission']);
    if (!['dsh', 'codex'].includes(v.to)) throw Error('destination_required');
    if ('dsh-permission' in v && (v.to !== 'dsh' || v['dsh-permission'] !== 'inherit')) throw Error('invalid_create_request');
    const cfg = projectConfig(base, v.project);
    const roots = v.root || (cfg.roots.length === 1 ? cfg.roots : []);
    if (roots.length !== 1) throw Error('one_registered_root_required');
    const req = { op: 'create', project: v.project, id: v['request-id'], title: v.title,
      root: rootPath(roots[0]), revision: cfg.revision, text: readText(v['text-file']),
      ...('dsh-permission' in v ? { dshPermission: v['dsh-permission'] } : {}) };
    validate(req);
    if (hostRoute(v)) return exchange(base, { ...req, target: 'codex' });
    if (v.to === 'dsh') return exchange(base, req);
    const binary = process.env.CODEX_DSH_CODEX || 'codex';
    if (binary !== 'codex' && !path.isAbsolute(binary)) throw Error('codex_binary_must_be_absolute');
    const value = await codexCreate(binary, req, cfg, base);
    return { ok: true, requestId: req.id, project: req.project, value };
  }
  if (!['send', 'status', 'result'].includes(command)) throw Error('unknown_command');
  allowedOptions(v, ['project', 'to', 'session', 'via', ...(command === 'send' ? ['request-id', 'text-file'] : [])]);
  if (!['dsh', 'codex'].includes(v.to)) throw Error('destination_required');
  const cfg = projectConfig(base, v.project);
  const req = { op: command, project: v.project, session: v.session,
    id: command === 'send' ? v['request-id'] : 'read', revision: cfg.revision };
  if (!validId(req.id)) throw Error('request_id_required');
  if (command === 'send') req.text = readText(v['text-file']);
  if (hostRoute(v)) { const wire = { ...req, target: 'codex' }; validate(wire); return exchange(base, wire); }
  if (v.to === 'dsh') { validate(req); return exchange(base, req); }
  if (command === 'result') throw Error('codex_result_not_supported_use_status');
  const binary = process.env.CODEX_DSH_CODEX || 'codex';
  if (binary !== 'codex' && !path.isAbsolute(binary)) throw Error('codex_binary_must_be_absolute');
  const value = command === 'status' ? await codexStatus(binary, req.session, cfg.roots) :
    await codexSend(binary, req, cfg, base);
  return { ok: true, requestId: req.id, project: req.project, value };
}

function hostRoute(v) {
  if (v.via && (!['host', 'direct'].includes(v.via) || v.to !== 'codex')) throw Error('invalid_route');
  return v.to === 'codex' && v.via !== 'direct';
}

try {
  const { values, positionals } = parse(process.argv.slice(2));
  if (positionals.length > 1) throw Error('unexpected_argument');
  const result = await execute(positionals[0] || 'help', values, home());
  if (result !== null) console.log(JSON.stringify(result, null, 2));
  if (result?.ok === false) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false,
    error: /^[a-z_]{1,80}$/.test(error.message) ? error.message : (error.code || 'bridge_failed'),
    note: 'No automatic retry. A timed-out send may have been accepted.' }));
  process.exitCode = 1;
}
