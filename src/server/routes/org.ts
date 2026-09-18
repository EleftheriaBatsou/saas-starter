import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.ts';
import { withSystem, type Queryable } from '../lib/db.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { parse, requireAuth, requireOrg, requirePermission } from '../lib/guards.ts';
import { updateSession } from '../lib/session.ts';
import { assignableRoles, canActOnMember, type Role } from '../../shared/permissions.ts';
import { listMyOrgs } from './auth.ts';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/, 'Use 1–40 lowercase letters, digits or dashes.');
const orgName = z.string().trim().min(1, 'Give your organisation a name.').max(80);

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export default async function orgRoutes(app: FastifyInstance) {
  // ---- Create an org (identity layer: the creator isn't a member yet) ------
  app.post('/api/orgs', { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(z.object({ name: orgName, slug }), req.body);
    const user = req.user!;
    const orgId = await withSystem(async (db) => {
      try {
        const { rows } = await db.query<{ id: string }>('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [body.name, body.slug]);
        const id = rows[0]!.id;
        await db.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')", [id, user.id]);
        await audit(db, { orgId: id, actorId: user.id, action: 'org.created', target: body.name, metadata: { slug: body.slug } });
        return id;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('SLUG_TAKEN', 'That URL slug is already taken.');
        throw err;
      }
    });
    await updateSession(req.session!, { activeOrgId: orgId });
    return reply.code(201).send({ id: orgId });
  });

  // ---- Active org --------------------------------------------------------
  app.get('/api/org', { preHandler: requireOrg }, async (req) => {
    const org = req.org!;
    return req.tenant(async (db) => {
      const { rows } = await db.query(
        `SELECT o.id, o.name, o.slug, o.created_at AS "createdAt",
                (SELECT count(*)::int FROM memberships) AS "memberCount",
                (SELECT count(*)::int FROM projects) AS "projectCount"
           FROM organizations o WHERE o.id = $1`,
        [org.id],
      );
      return { org: { ...rows[0], role: org.role } };
    });
  });

  app.patch('/api/org', { preHandler: requirePermission('org:update') }, async (req) => {
    const body = parse(z.object({ name: orgName.optional(), slug: slug.optional() }), req.body);
    const org = req.org!;
    return req.tenant(async (db) => {
      const changes: Record<string, { from: string; to: string }> = {};
      if (body.name && body.name !== org.name) changes.name = { from: org.name, to: body.name };
      if (body.slug && body.slug !== org.slug) changes.slug = { from: org.slug, to: body.slug };
      if (!Object.keys(changes).length) return { org: { id: org.id, name: org.name, slug: org.slug } };
      try {
        const { rows } = await db.query(
          'UPDATE organizations SET name = coalesce($2, name), slug = coalesce($3, slug) WHERE id = $1 RETURNING id, name, slug',
          [org.id, body.name ?? null, body.slug ?? null],
        );
        await audit(db, { orgId: org.id, actorId: req.user!.id, action: 'org.updated', target: org.name, metadata: changes });
        return { org: rows[0] };
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('SLUG_TAKEN', 'That URL slug is already taken.');
        throw err;
      }
    });
  });

  app.delete('/api/org', { preHandler: requirePermission('org:delete') }, async (req) => {
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
    const org = req.org!;
    if (confirm !== org.slug) throw badRequest('CONFIRMATION_MISMATCH', `Type "${org.slug}" to confirm.`, { fields: { confirm: 'Does not match.' } });
    await req.tenant(async (db) => {
      const { rowCount } = await db.query('DELETE FROM organizations WHERE id = $1', [org.id]);
      if (!rowCount) throw notFound('Organisation');
    });
    // The org's audit trail is deleted with it; keep a record in the server log.
    req.log.warn({ orgId: org.id, slug: org.slug, actor: req.user!.id }, 'organisation deleted');
    const remaining = await listMyOrgs(req.user!.id);
    await updateSession(req.session!, { activeOrgId: remaining[0]?.id ?? null });
    return { ok: true };
  });

  app.post('/api/org/transfer', { preHandler: requirePermission('org:transfer') }, async (req) => {
    const { userId } = parse(z.object({ userId: z.uuid() }), req.body);
    const org = req.org!;
    const actor = req.user!;
    if (userId === actor.id) throw badRequest('INVALID_TARGET', 'You already own this organisation.');
    await req.tenant(async (db) => {
      const target = await db.query<{ email: string }>(
        'SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
        [userId],
      );
      if (!target.rows[0]) throw notFound('Member');
      // Demote first: the DB allows exactly one owner per org.
      await db.query("UPDATE memberships SET role = 'admin' WHERE user_id = $1", [actor.id]);
      await db.query("UPDATE memberships SET role = 'owner' WHERE user_id = $1", [userId]);
      await audit(db, { orgId: org.id, actorId: actor.id, action: 'org.ownership_transferred', target: target.rows[0].email });
    });
    return { ok: true };
  });

  app.post('/api/org/leave', { preHandler: requireOrg }, async (req) => {
    const org = req.org!;
    const user = req.user!;
    if (org.role === 'owner') throw badRequest('OWNER_CANNOT_LEAVE', 'Transfer ownership before leaving.');
    await req.tenant(async (db) => {
      await audit(db, { orgId: org.id, actorId: user.id, action: 'member.left', target: user.email });
      await db.query('DELETE FROM memberships WHERE user_id = $1', [user.id]);
    });
    const remaining = await listMyOrgs(user.id);
    await updateSession(req.session!, { activeOrgId: remaining[0]?.id ?? null });
    return { ok: true };
  });

  // ---- Members -----------------------------------------------------------
  app.get('/api/members', { preHandler: requirePermission('member:read') }, async (req) => {
    return req.tenant(async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.email, m.role, m.joined_at AS "joinedAt"
           FROM memberships m JOIN users u ON u.id = m.user_id
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
      );
      return { members: rows };
    });
  });

  async function loadTarget(db: Queryable, userId: string) {
    const { rows } = await db.query(
      'SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
      [userId],
    );
    return rows[0] as { email: string; role: Role } | undefined;
  }

  app.patch('/api/members/:userId', { preHandler: requirePermission('member:manage') }, async (req) => {
    const { userId } = parse(z.object({ userId: z.uuid() }), req.params);
    const { role } = parse(z.object({ role: z.enum(['owner', 'admin', 'member']) }), req.body);
    const org = req.org!;
    const actor = req.user!;
    return req.tenant(async (db) => {
      const target = await loadTarget(db, userId);
      if (!target) throw notFound('Member');
      if (!canActOnMember(org.role, actor.id, target.role, userId)) throw forbidden("You can't change this member's role.");
      if (!assignableRoles(org.role).includes(role)) {
        throw forbidden(role === 'owner' ? 'Use "Transfer ownership" to make someone the owner.' : "You can't assign that role.");
      }
      if (role === target.role) return { ok: true };
      await db.query('UPDATE memberships SET role = $2 WHERE user_id = $1', [userId, role]);
      await audit(db, { orgId: org.id, actorId: actor.id, action: 'member.role_changed', target: target.email, metadata: { from: target.role, to: role } });
      return { ok: true };
    });
  });

  app.delete('/api/members/:userId', { preHandler: requirePermission('member:manage') }, async (req) => {
    const { userId } = parse(z.object({ userId: z.uuid() }), req.params);
    const org = req.org!;
    const actor = req.user!;
    await req.tenant(async (db) => {
      const target = await loadTarget(db, userId);
      if (!target) throw notFound('Member');
      if (!canActOnMember(org.role, actor.id, target.role, userId)) {
        throw forbidden(userId === actor.id ? 'Use "Leave organisation" instead.' : "You can't remove this member.");
      }
      await db.query('DELETE FROM memberships WHERE user_id = $1', [userId]);
      await audit(db, { orgId: org.id, actorId: actor.id, action: 'member.removed', target: target.email, metadata: { role: target.role } });
    });
    return { ok: true };
  });

  // ---- Audit log ---------------------------------------------------------
  app.get('/api/audit', { preHandler: requirePermission('audit:read') }, async (req) => {
    const q = parse(
      z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      req.query,
    );
    return req.tenant(async (db) => {
      const { rows } = await db.query(
        `SELECT a.id::text AS id, a.action, a.target, a.metadata, a.ts,
                u.name AS "actorName", u.email AS "actorEmail"
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ($1::bigint IS NULL OR a.id < $1)
          ORDER BY a.id DESC
          LIMIT $2`,
        [q.before ?? null, q.limit],
      );
      return { entries: rows, nextCursor: rows.length === q.limit ? rows[rows.length - 1].id : null };
    });
  });
}
