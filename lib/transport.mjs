import net from 'node:net';
import fs from 'node:fs';
import { socketPath } from './config.mjs';

export function exchange(base, req, { timeoutMs = 15000 } = {}) {
  const endpoint = socketPath(base), st = fs.lstatSync(endpoint);
  if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o077)) throw Error('unsafe_socket');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let raw = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(Error('transport_timeout_delivery_unknown')), timeoutMs);
    socket.on('close', () => { clearTimeout(timer); reject(Error('incomplete_response')); });
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify(req) + '\n'));
    socket.on('data', chunk => {
      raw = Buffer.concat([raw, chunk]);
      if (raw.length > 65536) socket.destroy(Error('response_too_large'));
    });
    socket.on('end', () => {
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        if (!raw.includes(10)) throw Error('incomplete_response');
        if (!value || Array.isArray(value) || typeof value.ok !== 'boolean') throw Error('invalid_response');
        if (!value.ok && (typeof value.error !== 'string' || !/^[a-z_]{1,80}$/.test(value.error) ||
            Object.keys(value).some(k => !['ok', 'error'].includes(k)))) throw Error('invalid_response');
        if (value.ok && (!value.value || value.value.membershipVerified !== true ||
            Object.keys(value).some(k => !['ok', 'requestId', 'project', 'value'].includes(k)))) throw Error('invalid_response');
        if (value.ok && (value.requestId !== req.id || value.project !== req.project ||
            value.value?.sessionId !== req.session)) throw Error('response_identity_mismatch');
        if (value.ok && req.op === 'send' && (value.value.accepted !== true ||
            value.value.delivery !== 'queued_only')) throw Error('invalid_response');
        clearTimeout(timer);
        resolve(value);
      } catch (e) { reject(e); }
    });
  });
}
