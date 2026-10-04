import path from 'node:path';
import { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { readJSON, writeNew } from './config.mjs';

export function channelKey(base, create = false) {
  const file = path.join(base, 'channel-key.json');
  if (create) {
    try { writeNew(file, { version: 1, key: randomBytes(32).toString('hex') }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const record = readJSON(file);
  if (!record || Object.keys(record).sort().join(',') !== 'key,version' || record.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(record.key)) throw Error('invalid_channel_key');
  return Buffer.from(record.key, 'hex');
}

function mac(key, text) { return createHmac('sha256', key).update(text).digest(); }
function codec(key, challenge) {
  return {
    seal(value, direction) {
      const raw = Buffer.from(JSON.stringify(value));
      if (raw.length > 65536) throw Error('response_too_large');
      const iv = randomBytes(12), secret = mac(key, 'bridge-v1/' + direction + '/' + challenge);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(Buffer.from('bridge-v1/' + direction + '/' + challenge));
      const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
      return { iv: iv.toString('hex'), data: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('hex') };
    },
    open(packet, direction) {
      try {
        if (!packet || Object.keys(packet).sort().join(',') !== 'data,iv,tag' ||
            !/^[a-f0-9]{24}$/.test(packet.iv) || !/^[a-f0-9]{32}$/.test(packet.tag) ||
            typeof packet.data !== 'string' || packet.data.length > 87384) throw Error();
        const ciphertext = Buffer.from(packet.data, 'base64');
        if (ciphertext.toString('base64') !== packet.data || ciphertext.length > 65536) throw Error();
        const decipher = createDecipheriv('aes-256-gcm', mac(key, 'bridge-v1/' + direction + '/' + challenge), Buffer.from(packet.iv, 'hex'));
        decipher.setAAD(Buffer.from('bridge-v1/' + direction + '/' + challenge));
        decipher.setAuthTag(Buffer.from(packet.tag, 'hex'));
        const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
      } catch { throw Error('authentication_failed'); }
    }
  };
}

export function serverChannel(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('invalid_channel_key');
  const challenge = randomBytes(32).toString('hex');
  return { hello: { version: 1, challenge, proof: mac(key, 'server/' + challenge).toString('hex') }, ...codec(key, challenge) };
}

export function clientChannel(key, hello) {
  if (!hello || Object.keys(hello).sort().join(',') !== 'challenge,proof,version' || hello.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(hello.challenge) || !/^[a-f0-9]{64}$/.test(hello.proof) ||
      !timingSafeEqual(mac(key, 'server/' + hello.challenge), Buffer.from(hello.proof, 'hex'))) throw Error('authentication_failed');
  return codec(key, hello.challenge);
}
