import crypto from 'node:crypto';
import { config } from './config.js';

const key = /^[a-f0-9]{64}$/i.test(config.dataKey)
  ? Buffer.from(config.dataKey, 'hex')
  : crypto.createHash('sha256').update(`narevo:${config.token || 'local-demo-only'}`).digest();

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), payload].map(x => x.toString('base64url')).join('.');
}

export function decrypt(value) {
  const [iv, tag, payload] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
}

export function verifyTelegram(initData) {
  if (config.demo && !initData) return { id: 10001, first_name: 'Demo', username: 'demo' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Date.now() / 1000 - authDate > 3600) throw new Error('Invalid Telegram session');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.token).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('Invalid Telegram signature');
  return JSON.parse(params.get('user'));
}
