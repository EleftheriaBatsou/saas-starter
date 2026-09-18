import { createHash, createHmac, randomBytes } from 'node:crypto';
import { config } from '../config.ts';

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Keyed hash for storing bearer secrets (session ids, email tokens) in the cache. */
export function keyedHash(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}
