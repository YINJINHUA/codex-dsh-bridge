import net from 'node:net';
import fs from 'node:fs';
import { socketPath, uuid } from './config.mjs';
import { isWindows } from './windows.mjs';
import { channelKey as loadKey, clientChannel } from './secure-channel.mjs';

export function exchange(base, req, { timeoutMs = req.target === 'codex' && req.op === 'create' ? 225000 :
  isWindows || req.target === 'codex' || req.op === 'create' ? 90000 : 15000, channelKey } = {}) {
  const endpoint = socketPath(base);
  let key;
  try {
    if (!isWindows) {
      const st = fs.lstatSync(endpoint);
      if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o077)) throw Error('unsafe_socket');
    }
    key = isWindows ? loadKey(base) : channelKey;
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('bridge_not_ready');
    throw error;
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let raw = Buffer.alloc(0), channel = null;
    const timer = setTimeout(() => socket.destroy(Error('transport_timeout_delivery_unknown')), timeoutMs);
    socket.on('close', () => { clearTimeout(timer); reject(Error('incomplete_response')); });
    socket.on('error', error => reject(['ENOENT', 'ECONNREFUSED'].includes(error.code) ? Error('bridge_not_ready') : error));
    socket.on('connect', () => { if (!key) socket.write(JSON.stringify(req) + '\n'); });
    socket.on('data', chunk => {
      raw = Buffer.concat([raw, chunk]);
      if (raw.length > (key ? 98304 : 65536)) return socket.destroy(Error('response_too_large'));
      if (key && !channel && raw.includes(10)) {
        try {
          const end = raw.indexOf(10);
          channel = clientChannel(key, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(0, end))));
          raw = raw.subarray(end + 1);
          socket.write(JSON.stringify(channel.seal(req, 'request')) + '\n');
        } catch { socket.destroy(Error('authentication_failed')); }
      }
    });
    socket.on('end', () => {
      try {
        if (!raw.length || raw.at(-1) !== 10) throw Error('incomplete_response');
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
        catch { throw Error('invalid_response'); }
        if (key) { if (!channel) throw Error('authentication_failed'); value = channel.open(value, 'response'); }
        if (!value || Array.isArray(value) || typeof value.ok !== 'boolean') throw Error('invalid_response');
        if (!value.ok && (typeof value.error !== 'string' || !/^[a-z_]{1,80}$/.test(value.error) ||
            Object.keys(value).some(k => !['ok', 'error'].includes(k)))) throw Error('invalid_response');
        if (value.ok && (!value.value || value.value.membershipVerified !== true ||
            Object.keys(value).some(k => !['ok', 'requestId', 'project', 'value'].includes(k)))) throw Error('invalid_response');
        if (value.ok && (value.requestId !== req.id || value.project !== req.project ||
            (req.op !== 'create' && value.value?.sessionId !== req.session))) throw Error('response_identity_mismatch');
        if (value.ok && req.op === 'create') {
          const created = value.value;
          if (created.created !== true || typeof created.sessionId !== 'string' || created.requestId !== req.id ||
              (req.target === 'codex' ? !uuid(created.sessionId) || created.initialDelivery !== 'turn_completed' :
                !created.sessionId.startsWith('session-') || !uuid(created.sessionId.slice(8)) ||
                created.initialDelivery !== 'queued_only')) throw Error('invalid_response');
        }
        if (value.ok && req.op === 'send' && (value.value.accepted !== true ||
            value.value.delivery !== 'queued_only')) throw Error('invalid_response');
        clearTimeout(timer);
        resolve(value);
      } catch (e) { reject(e); }
    });
  });
}
