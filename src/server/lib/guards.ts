import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { can, type Permission, type Role } from '../../shared/permissions.ts';
import { withSystem, withTenant, type Queryable } from './db.ts';
import { badRequest, forbidden, HttpError, unauthorized } from './errors.ts';
import { loadSession, updateSession, type Session } from './session.ts';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
}

export interface ActiveOrg {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
    user: AuthUser | null;
    org: ActiveOrg | null;
    /** Run a callback inside the RLS-scoped transaction for the active org. */
    tenant: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;
  }
}

/** Resolve session + user. 401 if missing, expired or revoked. */
async function authenticate(req: FastifyRequest): Promise<void> {
  const session = await loadSession(req);
  if (!session) throw unauthorized();
  const { rows } = await withSystem((db) =>
    db.query<AuthUser>(
      'SELECT id, email, name, email_verified_at AS "emailVerifiedAt" FROM users WHERE id = $1',
      [session.userId],
    ),
  );
  if (!rows[0]) throw unauthorized();
  req.session = session;
  req.user = rows[0];
}

/**
 * Resolve the active org FROM THE SESSION (never from the URL/body) and verify
 * membership on every request, so removals and role changes apply instantly.
 * Afterwards `req.tenant()` is the only way handlers touch tenant data.
 */
async function resolveOrg(req: FastifyRequest): Promise<void> {
  await authenticate(req);
  const session = req.session!;
  const user = req.user!;
  const orgId = session.activeOrgId;
  if (!orgId) throw new HttpError(403, 'NO_ACTIVE_ORG', 'Choose or create an organisation first.');

  const org = await withTenant({ orgId, userId: user.id }, async (db) => {
    const { rows } = await db.query<ActiveOrg>(
      `SELECT o.id, o.name, o.slug, m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.org_id = $1 AND m.user_id = $2`,
      [orgId, user.id],
    );
    return rows[0];
  });
  if (!org) {
    await updateSession(session, { activeOrgId: null });
    throw new HttpError(403, 'NOT_A_MEMBER', 'You are no longer a member of that organisation.');
  }

  // Multi-tab safety: the client states which org it is rendering. If another
  // tab switched orgs, refuse rather than silently writing into the wrong one.
  const expected = req.headers['x-org-id'];
  if (typeof expected === 'string' && expected && expected !== org.id) {
    throw new HttpError(409, 'ORG_MISMATCH', 'Your active organisation changed in another tab. Reloading…');
  }

  req.org = org;
  req.tenant = (fn) => withTenant({ orgId: org.id, userId: user.id }, fn);
}

export const requireAuth: preHandlerAsyncHookHandler = async (req) => authenticate(req);
export const requireOrg: preHandlerAsyncHookHandler = async (req) => resolveOrg(req);

/** Every mutating tenant endpoint declares exactly one permission from shared/permissions.ts. */
export function requirePermission(permission: Permission): preHandlerAsyncHookHandler {
  return async (req) => {
    await resolveOrg(req);
    if (!can(req.org!.role, permission)) throw forbidden();
  };
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw badRequest('VALIDATION', 'Please fix the highlighted fields.', { fields });
  }
  return result.data;
}

export function clientIp(req: FastifyRequest): string {
  return req.ip || 'unknown';
}

export type Reply = FastifyReply;
