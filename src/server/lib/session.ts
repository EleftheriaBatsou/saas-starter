import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from './cache.ts';
import { keyedHash, randomToken } from './crypto.ts';
import { config } from '../config.ts';

/**
 * Server-side sessions in Valkey. The browser only holds an opaque random id
 * in an httpOnly/Secure/SameSite=Lax cookie; the cache key is an HMAC of that
 * id, so a cache dump can't be replayed as cookies. Deleting the key revokes
 * the session instantly (logout, password reset, "sign out everywhere").
 */

export const SESSION_COOKIE = '__Host-sid';

export interface SessionData {
  userId: string;
  activeOrgId: string | null;
  createdAt: number;
}

export interface Session extends SessionData {
  key: string;
}

const sessKey = (hash: string) => `sess:${hash}`;
const userSetKey = (userId: string) => `usess:${userId}`;

export async function createSession(reply: FastifyReply, userId: string, activeOrgId: string | null): Promise<Session> {
  const id = randomToken();
  const hash = keyedHash(id);
  const data: SessionData = { userId, activeOrgId, createdAt: Date.now() };
  await redis
    .multi()
    .set(sessKey(hash), JSON.stringify(data), 'EX', config.sessionTtlSeconds)
    .sadd(userSetKey(userId), hash)
    .expire(userSetKey(userId), config.sessionAbsoluteSeconds)
    .exec();
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlSeconds,
  });
  return { ...data, key: hash };
}

export async function loadSession(req: FastifyRequest): Promise<Session | null> {
  const id = req.cookies[SESSION_COOKIE];
  if (!id || id.length > 100) return null;
  const hash = keyedHash(id);
  const raw = await redis.get(sessKey(hash));
  if (!raw) return null;
  const data = JSON.parse(raw) as SessionData;
  if (Date.now() - data.createdAt > config.sessionAbsoluteSeconds * 1000) {
    await destroySessionByKey(hash, data.userId);
    return null;
  }
  // Sliding expiry.
  await redis.expire(sessKey(hash), config.sessionTtlSeconds);
  return { ...data, key: hash };
}

export async function updateSession(session: Session, patch: Partial<SessionData>): Promise<void> {
  const next: SessionData = {
    userId: session.userId,
    activeOrgId: session.activeOrgId,
    createdAt: session.createdAt,
    ...patch,
  };
  // XX: never resurrect a session that was revoked concurrently.
  await redis.set(sessKey(session.key), JSON.stringify(next), 'EX', config.sessionTtlSeconds, 'XX');
  Object.assign(session, next);
}

export async function destroySessionByKey(hash: string, userId: string): Promise<void> {
  await redis.multi().del(sessKey(hash)).srem(userSetKey(userId), hash).exec();
}

export async function destroyAllSessions(userId: string, exceptKey?: string): Promise<number> {
  const hashes = await redis.smembers(userSetKey(userId));
  const doomed = hashes.filter((h) => h !== exceptKey);
  if (doomed.length) {
    await redis
      .multi()
      .del(...doomed.map(sessKey))
      .srem(userSetKey(userId), ...doomed)
      .exec();
  }
  return doomed.length;
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
}

// ---------------------------------------------------------------------------
// Single-use email tokens (verification, password reset) — also in Valkey.
// ---------------------------------------------------------------------------

export type EmailTokenKind = 'verify' | 'reset';

export async function issueEmailToken(kind: EmailTokenKind, userId: string, ttlSeconds: number): Promise<string> {
  const token = randomToken();
  await redis.set(`etok:${kind}:${keyedHash(token)}`, userId, 'EX', ttlSeconds);
  return token;
}

/** Atomically consumes the token; returns the user id or null if invalid/expired/used. */
export async function consumeEmailToken(kind: EmailTokenKind, token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  return redis.getdel(`etok:${kind}:${keyedHash(token)}`);
}
