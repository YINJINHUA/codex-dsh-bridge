#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { home, projectConfig, projectFile, register, readJSON, validId, slug, syncDir } from '../lib/config.mjs';
import { exchange } from '../lib/transport.mjs';
import { codexStatus, codexSend } from '../lib/codex.mjs';
import { validate } from '../plugin/core.mjs';

const help = `Codex ↔ DSH 项目通信桥 0.2.1
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
Codex CLI 默认从 PATH 发现；可用环境变量 CODEX_DSH_CODEX 指定可信绝对路径。
本机登记默认放在 ~/.codex-dsh-bridge，DSH 插件与 CLI 必须使用同一目录。
退出 0 是查询/入队成功，不是任务完成。超时不要换编号盲目重发。
注册不会创建 DSH/Codex 项目。完整说明见 README.md。`;

export function parse(argv) {
  return parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    project: { type: 'string' }, root: { type: 'string', multiple: true },
    to: { type: 'string' }, session: { type: 'string' },
    'request-id': { type: 'string' }, 'text-file': { type: 'string' }
  } });
}

function readText(file) {
  if (!file) throw Error('text_file_required');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192) throw Error('invalid_text_file');
    const bytes = Buffer.alloc(8193), count = fs.readSync(fd, bytes);
    if (count > 8192) throw Error('invalid_text');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
    if (!text.trim() || Buffer.byteLength(text) > 8192) throw Error('invalid_text');
    return text;
  } finally { fs.closeSync(fd); }
}

function allowedOptions(values, keys) {
  if (Object.keys(values).some(k => !keys.includes(k))) throw Error('unexpected_option');
}

async function execute(command, v, base) {
  if (command === 'help') { allowedOptions(v, []); console.log(help); return null; }
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
  if (!['send', 'status', 'result'].includes(command)) throw Error('unknown_command');
  allowedOptions(v, ['project', 'to', 'session', ...(command === 'send' ? ['request-id', 'text-file'] : [])]);
  if (!['dsh', 'codex'].includes(v.to)) throw Error('destination_required');
  const cfg = projectConfig(base, v.project);
  const req = { op: command, project: v.project, session: v.session,
    id: command === 'send' ? v['request-id'] : 'read', revision: cfg.revision };
  if (!validId(req.id)) throw Error('request_id_required');
  if (command === 'send') req.text = readText(v['text-file']);
  if (v.to === 'dsh') { validate(req); return exchange(base, req); }
  if (command === 'result') throw Error('codex_result_not_supported_use_status');
  const binary = process.env.CODEX_DSH_CODEX || 'codex';
  if (binary !== 'codex' && !path.isAbsolute(binary)) throw Error('codex_binary_must_be_absolute');
  const value = command === 'status' ? await codexStatus(binary, req.session, cfg.roots) :
    await codexSend(binary, req, cfg, base);
  return { ok: true, requestId: req.id, project: req.project, value };
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
