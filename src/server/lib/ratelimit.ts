import { redis } from './cache.ts';
import { tooManyRequests } from './errors.ts';

/**
 * Fixed-window counter in Valkey. Returns the attempt count after increment.
 * Throws 429 when the limit is exceeded.
 */
export async function hit(key: string, limit: number, windowSeconds: number, message?: string): Promise<number> {
  const k = `rl:${key}`;
  const [[, count], , [, ttl]] = (await redis
    .multi()
    .incr(k)
    .expire(k, windowSeconds, 'NX')
    .ttl(k)
    .exec()) as [[null, number], [null, number], [null, number]];
  if (count > limit) throw tooManyRequests(Math.max(ttl, 1), message);
  return count;
}

/** Check without incrementing (e.g. before verifying a password). */
export async function assertUnder(key: string, limit: number, message?: string): Promise<void> {
  const k = `rl:${key}`;
  const [[, raw], [, ttl]] = (await redis.multi().get(k).ttl(k).exec()) as [[null, string | null], [null, number]];
  if (Number(raw ?? 0) >= limit) throw tooManyRequests(Math.max(ttl, 1), message);
}

export async function reset(key: string): Promise<void> {
  await redis.del(`rl:${key}`);
}

export const LIMITS = {
  loginPerIp: { limit: 30, window: 15 * 60 },
  loginFailuresPerAccount: { limit: 5, window: 15 * 60 },
  resetPerEmail: { limit: 3, window: 60 * 60 },
  resetPerIp: { limit: 10, window: 60 * 60 },
  signupPerIp: { limit: 10, window: 60 * 60 },
  verifyResendPerUser: { limit: 3, window: 60 * 60 },
  invitesPerOrg: { limit: 50, window: 60 * 60 },
} as const;
