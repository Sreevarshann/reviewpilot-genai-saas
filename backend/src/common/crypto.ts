import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random, URL-safe token. Only its SHA-256 hash is ever stored. */
export const randomToken = (prefix = ''): string => prefix + randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
