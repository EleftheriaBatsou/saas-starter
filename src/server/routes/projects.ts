import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.ts';
import { notFound } from '../lib/errors.ts';
import { parse, requirePermission } from '../lib/guards.ts';

// Note: no query below filters by org_id. That's deliberate — isolation is
// enforced by the RLS policies req.tenant() runs under, so the scoping can't
// be forgotten. INSERTs set org_id explicitly and WITH CHECK rejects any
// value other than the active org.

const COLUMNS = `id, name, description, status, color, created_at AS "createdAt", updated_at AS "updatedAt",
  (SELECT name FROM users u WHERE u.id = projects.created_by) AS "createdBy"`;

const fields = {
  name: z.string().trim().min(1, 'Give the project a name.').max(120),
  description: z.string().trim().max(2000),
  status: z.enum(['active', 'paused', 'done']),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Pick a colour.'),
};
const createBody = z.object({
  name: fields.name,
  description: fields.description.default(''),
  status: fields.status.default('active'),
  color: fields.color.default('#7C5CFF'),
});
// No defaults here: an omitted field must stay untouched.
const updateBody = z.object(fields).partial();

// Malformed ids are reported exactly like ids from other orgs: not found.
function projectId(params: unknown): string {
  const r = z.object({ id: z.uuid() }).safeParse(params);
  if (!r.success) throw notFound('Project');
  return r.data.id;
}

export default async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', { preHandler: requirePermission('project:read') }, async (req) => {
    return req.tenant(async (db) => {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM projects ORDER BY created_at DESC`);
      return { projects: rows };
    });
  });

  app.get('/api/projects/:id', { preHandler: requirePermission('project:read') }, async (req) => {
    const id = projectId(req.params);
    return req.tenant(async (db) => {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM projects WHERE id = $1`, [id]);
      if (!rows[0]) throw notFound('Project');
      return { project: rows[0] };
    });
  });

  app.post('/api/projects', { preHandler: requirePermission('project:create') }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const org = req.org!;
    const project = await req.tenant(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO projects (org_id, name, description, status, color, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [org.id, body.name, body.description, body.status, body.color, req.user!.id],
      );
      await audit(db, { orgId: org.id, actorId: req.user!.id, action: 'project.created', target: body.name });
      return rows[0];
    });
    return reply.code(201).send({ project });
  });

  app.patch('/api/projects/:id', { preHandler: requirePermission('project:update') }, async (req) => {
    const id = projectId(req.params);
    const body = parse(updateBody, req.body);
    return req.tenant(async (db) => {
      const { rows } = await db.query(
        `UPDATE projects SET
            name = coalesce($2, name), description = coalesce($3, description),
            status = coalesce($4, status), color = coalesce($5, color), updated_at = now()
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, body.name ?? null, body.description ?? null, body.status ?? null, body.color ?? null],
      );
      if (!rows[0]) throw notFound('Project');
      await audit(db, { orgId: req.org!.id, actorId: req.user!.id, action: 'project.updated', target: rows[0].name, metadata: body });
      return { project: rows[0] };
    });
  });

  app.delete('/api/projects/:id', { preHandler: requirePermission('project:delete') }, async (req) => {
    const id = projectId(req.params);
    await req.tenant(async (db) => {
      const { rows } = await db.query<{ name: string }>('DELETE FROM projects WHERE id = $1 RETURNING name', [id]);
      if (!rows[0]) throw notFound('Project');
      await audit(db, { orgId: req.org!.id, actorId: req.user!.id, action: 'project.deleted', target: rows[0].name });
    });
    return { ok: true };
  });
}
