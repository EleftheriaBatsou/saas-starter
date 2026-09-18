import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { audit } from '../lib/audit.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { withSystem, type Queryable } from '../lib/db.ts';
import { conflict, forbidden, HttpError, notFound } from '../lib/errors.ts';
import { parse, requireAuth, requirePermission } from '../lib/guards.ts';
import { sendMail } from '../lib/mailer.ts';
import { hit, LIMITS } from '../lib/ratelimit.ts';
import { updateSession } from '../lib/session.ts';
import { assignableRoles, type Role } from '../../shared/permissions.ts';

type InviteRow = {
  id: string;
  org_id: string;
  org_name: string;
  email: string;
  role: Role;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
};

function inviteStatus(i: Pick<InviteRow, 'expires_at' | 'accepted_at' | 'revoked_at'>) {
  if (i.accepted_at) return 'accepted' as const;
  if (i.revoked_at) return 'revoked' as const;
  if (i.expires_at.getTime() <= Date.now()) return 'expired' as const;
  return 'pending' as const;
}

async function findByToken(db: Queryable, token: string, lock = false): Promise<InviteRow | undefined> {
  if (!token || token.length > 100) return undefined;
  const { rows } = await db.query<InviteRow>(
    `SELECT i.id, i.org_id, o.name AS org_name, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
       FROM invitations i JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = $1 ${lock ? 'FOR UPDATE OF i' : ''}`,
    [sha256(token)],
  );
  return rows[0];
}

/**
 * Identity-layer operation (runs on the system connection because the user is
 * not yet a member of the org). The token itself is the capability; we still
 * require the accepting account's email to match the invited address.
 */
export async function acceptInvitation(db: Queryable, token: string, user: { id: string; email: string }) {
  const invite = await findByToken(db, token, true);
  if (!invite) throw new HttpError(404, 'INVITE_INVALID', 'This invitation link is not valid.');
  const status = inviteStatus(invite);
  if (status === 'revoked') throw new HttpError(410, 'INVITE_REVOKED', 'This invitation has been revoked.');
  if (status === 'accepted') throw new HttpError(409, 'INVITE_USED', 'This invitation has already been used.');
  if (status === 'expired') throw new HttpError(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask an admin to resend it.');
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new HttpError(403, 'INVITE_EMAIL_MISMATCH', `This invitation was sent to ${invite.email}. Sign in with that account to accept it.`);
  }
  const inserted = await db.query(
    `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO NOTHING`,
    [invite.org_id, user.id, invite.role],
  );
  await db.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invite.id]);
  // Receiving the tokenised email proves the address.
  await db.query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [user.id]);
  if (inserted.rowCount) {
    await audit(db, { orgId: invite.org_id, actorId: user.id, action: 'invite.accepted', target: invite.email, metadata: { role: invite.role } });
  }
  return { orgId: invite.org_id, orgName: invite.org_name, alreadyMember: !inserted.rowCount };
}

function inviteLink(token: string) {
  return `${config.appUrl}/invite/${token}`;
}

export default async function invitationRoutes(app: FastifyInstance) {
  // ---- Public: token holder can see what they're accepting ----------------
  app.get('/api/invites/preview', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(100) }), req.query);
    const invite = await withSystem((db) => findByToken(db, token));
    if (!invite) throw new HttpError(404, 'INVITE_INVALID', 'This invitation link is not valid.');
    const { rowCount } = await withSystem((db) => db.query('SELECT 1 FROM users WHERE email = $1', [invite.email]));
    return {
      orgName: invite.org_name,
      email: invite.email,
      role: invite.role,
      status: inviteStatus(invite),
      expiresAt: invite.expires_at,
      accountExists: Boolean(rowCount),
    };
  });

  // ---- Existing (signed-in) user accepts ----------------------------------
  app.post('/api/invites/accept', { preHandler: requireAuth }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(100) }), req.body);
    const user = req.user!;
    const result = await withSystem((db) => acceptInvitation(db, token, user));
    await updateSession(req.session!, { activeOrgId: result.orgId });
    return { ok: true, ...result };
  });

  // ---- Admin: list / create / resend / revoke (RLS-scoped) ----------------
  app.get('/api/invitations', { preHandler: requirePermission('invite:manage') }, async (req) => {
    return req.tenant(async (db) => {
      const { rows } = await db.query(
        `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
                u.name AS invited_by_name
           FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
          ORDER BY i.created_at DESC
          LIMIT 200`,
      );
      return {
        invitations: rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role,
          status: inviteStatus(r),
          expiresAt: r.expires_at,
          createdAt: r.created_at,
          invitedBy: r.invited_by_name ?? null,
        })),
      };
    });
  });

  app.post('/api/invitations', { preHandler: requirePermission('invite:manage') }, async (req, reply) => {
    const org = req.org!;
    const actor = req.user!;
    const body = parse(
      z.object({
        email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.').max(254)),
        role: z.enum(['admin', 'member'], 'Choose a role.'),
      }),
      req.body,
    );
    if (!actor.emailVerifiedAt) {
      throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Verify your own email address before inviting people.');
    }
    if (!assignableRoles(org.role).includes(body.role)) throw forbidden('You cannot invite people with that role.');
    await hit(`invite:org:${org.id}`, LIMITS.invitesPerOrg.limit, LIMITS.invitesPerOrg.window);

    const token = randomToken();
    const invitation = await req.tenant(async (db) => {
      const member = await db.query(
        'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1',
        [body.email],
      );
      if (member.rowCount) throw conflict('ALREADY_MEMBER', `${body.email} is already a member.`);
      const open = await db.query<{ id: string; expires_at: Date }>(
        'SELECT id, expires_at FROM invitations WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL',
        [body.email],
      );
      if (open.rows[0]) {
        if (open.rows[0].expires_at.getTime() > Date.now()) {
          throw conflict('INVITE_PENDING', `${body.email} already has a pending invite — resend it instead.`);
        }
        await db.query('UPDATE invitations SET revoked_at = now() WHERE id = $1', [open.rows[0].id]);
      }
      const { rows } = await db.query(
        `INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
         RETURNING id, email, role, expires_at, created_at`,
        [org.id, body.email, body.role, sha256(token), actor.id, config.inviteTtlSeconds],
      );
      await audit(db, { orgId: org.id, actorId: actor.id, action: 'invite.created', target: body.email, metadata: { role: body.role } });
      return rows[0];
    });

    const link = inviteLink(token);
    await sendMail(
      {
        to: body.email,
        subject: `${actor.name} invited you to ${org.name}`,
        text: `${actor.name} invited you to join ${org.name} as ${body.role}.\n\nAccept: ${link}\n\nThis invitation expires in 7 days.`,
        link,
      },
      req.log,
    );
    return reply.code(201).send({
      invitation: { ...invitation, status: 'pending', expiresAt: invitation.expires_at, createdAt: invitation.created_at, invitedBy: actor.name },
      // Convenience for local testing only; production never returns the token.
      ...(config.isProd ? {} : { devInviteUrl: link }),
    });
  });

  app.post('/api/invitations/:id/resend', { preHandler: requirePermission('invite:manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const org = req.org!;
    const actor = req.user!;
    const token = randomToken();
    const invite = await req.tenant(async (db) => {
      const { rows } = await db.query<{ email: string; role: Role }>(
        `UPDATE invitations SET token_hash = $2, expires_at = now() + make_interval(secs => $3)
          WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
          RETURNING email, role`,
        [id, sha256(token), config.inviteTtlSeconds],
      );
      if (!rows[0]) throw notFound('Pending invitation');
      await audit(db, { orgId: org.id, actorId: actor.id, action: 'invite.resent', target: rows[0].email });
      return rows[0];
    });
    const link = inviteLink(token);
    await sendMail(
      { to: invite.email, subject: `Reminder: join ${org.name}`, text: `${actor.name} invited you to join ${org.name} as ${invite.role}.\n\nAccept: ${link}`, link },
      req.log,
    );
    return { ok: true, ...(config.isProd ? {} : { devInviteUrl: link }) };
  });

  app.post('/api/invitations/:id/revoke', { preHandler: requirePermission('invite:manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const org = req.org!;
    await req.tenant(async (db) => {
      const { rows } = await db.query<{ email: string }>(
        'UPDATE invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email',
        [id],
      );
      if (!rows[0]) throw notFound('Pending invitation');
      await audit(db, { orgId: org.id, actorId: req.user!.id, action: 'invite.revoked', target: rows[0].email });
    });
    return { ok: true };
  });
}
