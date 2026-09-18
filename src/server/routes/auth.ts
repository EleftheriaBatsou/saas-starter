import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { withSystem } from '../lib/db.ts';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.ts';
import { clientIp, parse, requireAuth } from '../lib/guards.ts';
import { sendMail } from '../lib/mailer.ts';
import { burnPasswordCheck, checkPasswordPolicy, hashPassword, verifyPassword } from '../lib/passwords.ts';
import { assertUnder, hit, LIMITS, reset } from '../lib/ratelimit.ts';
import {
  clearSessionCookie,
  consumeEmailToken,
  createSession,
  destroyAllSessions,
  destroySessionByKey,
  issueEmailToken,
  loadSession,
  updateSession,
} from '../lib/session.ts';
import { redis } from '../lib/cache.ts';
import { keyedHash } from '../lib/crypto.ts';
import { permissionsFor, type Role } from '../../shared/permissions.ts';
import { acceptInvitation } from './invitations.ts';
import { DEMO_PASSWORD, DEMO_USERS } from '../seed.ts';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.').max(254));
const password = z.string().min(1, 'Password is required.').max(128, 'Use at most 128 characters.');
const name = z.string().trim().min(1, 'Tell us your name.').max(100);

async function sendVerification(userId: string, to: string, log: FastifyInstance['log']) {
  const token = await issueEmailToken('verify', userId, 60 * 60 * 24);
  const link = `${config.appUrl}/verify-email?token=${token}`;
  await sendMail({ to, subject: 'Verify your email', text: `Confirm your email address:\n\n${link}\n\nThis link expires in 24 hours.`, link }, log);
}

function assertPolicy(pw: string, ctx: { email?: string; name?: string }) {
  const problems = checkPasswordPolicy(pw, ctx);
  if (problems.length) throw badRequest('WEAK_PASSWORD', problems[0]!, { fields: { password: problems.join(' ') }, problems });
}

export async function listMyOrgs(userId: string) {
  // Identity layer: the only cross-org read, and it is keyed on the caller's own id.
  return withSystem(async (db) => {
    const { rows } = await db.query<{ id: string; name: string; slug: string; role: Role }>(
      `SELECT o.id, o.name, o.slug, m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1
        ORDER BY o.name`,
      [userId],
    );
    return rows;
  });
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/signup', async (req, reply) => {
    await hit(`signup:ip:${clientIp(req)}`, LIMITS.signupPerIp.limit, LIMITS.signupPerIp.window);
    const body = parse(z.object({ name, email, password, inviteToken: z.string().max(100).optional() }), req.body);
    assertPolicy(body.password, body);
    const passwordHash = await hashPassword(body.password);

    const result = await withSystem(async (db) => {
      const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
      if (existing.rowCount) throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Try signing in.');
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [body.email, body.name, passwordHash],
      );
      const userId = rows[0]!.id;
      let orgId: string | null = null;
      if (body.inviteToken) {
        // New-user invite path: the emailed token proves inbox ownership.
        const accepted = await acceptInvitation(db, body.inviteToken, { id: userId, email: body.email });
        orgId = accepted.orgId;
      }
      return { userId, orgId };
    });

    await createSession(reply, result.userId, result.orgId);
    if (!result.orgId) await sendVerification(result.userId, body.email, req.log);
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const ip = clientIp(req);
    await hit(`login:ip:${ip}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window);
    const body = parse(z.object({ email, password }), req.body);
    const acctKey = `login:acct:${body.email}`;
    await assertUnder(acctKey, LIMITS.loginFailuresPerAccount.limit, 'Too many failed sign-in attempts. Try again later or reset your password.');

    const { rows } = await withSystem((db) =>
      db.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = $1', [body.email]),
    );
    const user = rows[0];
    const ok = user ? await verifyPassword(user.password_hash, body.password) : (await burnPasswordCheck(body.password), false);
    if (!user || !ok) {
      await hit(acctKey, Number.MAX_SAFE_INTEGER, LIMITS.loginFailuresPerAccount.window);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    await reset(acctKey);
    const orgs = await listMyOrgs(user.id);
    await createSession(reply, user.id, orgs[0]?.id ?? null);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const session = await loadSession(req);
    if (session) await destroySessionByKey(session.key, session.userId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout-all', { preHandler: requireAuth }, async (req, reply) => {
    const revoked = await destroyAllSessions(req.user!.id);
    clearSessionCookie(reply);
    return { ok: true, revoked };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const user = req.user!;
    const session = req.session!;
    const orgs = await listMyOrgs(user.id);
    let active = orgs.find((o) => o.id === session.activeOrgId) ?? null;
    if (!active && orgs[0]) active = orgs[0];
    if ((active?.id ?? null) !== session.activeOrgId) await updateSession(session, { activeOrgId: active?.id ?? null });
    return {
      user,
      orgs,
      activeOrgId: active?.id ?? null,
      role: active?.role ?? null,
      permissions: active ? permissionsFor(active.role) : [],
    };
  });

  app.post('/api/session/active-org', { preHandler: requireAuth }, async (req) => {
    const { orgId } = parse(z.object({ orgId: z.uuid() }), req.body);
    const orgs = await listMyOrgs(req.user!.id);
    const target = orgs.find((o) => o.id === orgId);
    if (!target) throw new HttpError(403, 'NOT_A_MEMBER', 'You are not a member of that organisation.');
    await updateSession(req.session!, { activeOrgId: target.id });
    return { ok: true, activeOrgId: target.id, role: target.role, permissions: permissionsFor(target.role) };
  });

  app.post('/api/auth/verify-email', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(100) }), req.body);
    const userId = await consumeEmailToken('verify', token);
    if (!userId) throw badRequest('INVALID_TOKEN', 'This verification link is invalid or has expired.');
    await withSystem((db) =>
      db.query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [userId]),
    );
    return { ok: true };
  });

  app.post('/api/auth/resend-verification', { preHandler: requireAuth }, async (req) => {
    const user = req.user!;
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    await hit(`verify:user:${user.id}`, LIMITS.verifyResendPerUser.limit, LIMITS.verifyResendPerUser.window);
    await sendVerification(user.id, user.email, req.log);
    return { ok: true };
  });

  app.post('/api/auth/password/forgot', async (req) => {
    const body = parse(z.object({ email }), req.body);
    await hit(`reset:ip:${clientIp(req)}`, LIMITS.resetPerIp.limit, LIMITS.resetPerIp.window);
    await hit(`reset:email:${body.email}`, LIMITS.resetPerEmail.limit, LIMITS.resetPerEmail.window);
    const { rows } = await withSystem((db) => db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [body.email]));
    if (rows[0]) {
      const token = await issueEmailToken('reset', rows[0].id, 60 * 60);
      const link = `${config.appUrl}/reset-password?token=${token}`;
      await sendMail(
        { to: body.email, subject: 'Reset your password', text: `Reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`, link },
        req.log,
      );
    }
    // Same response whether or not the account exists (no enumeration).
    return { ok: true };
  });

  app.post('/api/auth/password/reset', async (req) => {
    const body = parse(z.object({ token: z.string().min(1).max(100), password }), req.body);
    const peekUser = await redis.get(`etok:reset:${keyedHash(body.token)}`);
    if (!peekUser) throw badRequest('INVALID_TOKEN', 'This reset link is invalid or has expired.');
    const { rows } = await withSystem((db) =>
      db.query<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = $1', [peekUser]),
    );
    if (!rows[0]) throw badRequest('INVALID_TOKEN', 'This reset link is invalid or has expired.');
    assertPolicy(body.password, rows[0]);
    const userId = await consumeEmailToken('reset', body.token);
    if (userId !== peekUser) throw badRequest('INVALID_TOKEN', 'This reset link is invalid or has expired.');
    const hash = await hashPassword(body.password);
    await withSystem((db) =>
      db.query('UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [userId, hash]),
    );
    // Revoke every existing session: a reset means the old password may be compromised.
    await destroyAllSessions(userId);
    await reset(`login:acct:${rows[0].email}`);
    return { ok: true };
  });

  // Dev-only helper for the login screen's quick-switch chips.
  app.get('/api/demo', async () => {
    if (!config.seedDemo) throw notFound();
    return { password: DEMO_PASSWORD, users: DEMO_USERS };
  });
}
