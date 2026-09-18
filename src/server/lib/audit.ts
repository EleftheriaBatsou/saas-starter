import type { Queryable } from './db.ts';

export type AuditAction =
  | 'org.created'
  | 'org.updated'
  | 'org.ownership_transferred'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'member.left'
  | 'invite.created'
  | 'invite.resent'
  | 'invite.revoked'
  | 'invite.accepted'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted';

/**
 * Append an audit entry inside the caller's transaction, so the log entry
 * commits or rolls back together with the change it describes.
 */
export async function audit(
  db: Queryable,
  entry: { orgId: string; actorId: string | null; action: AuditAction; target?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (org_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)',
    [entry.orgId, entry.actorId, entry.action, entry.target ?? null, JSON.stringify(entry.metadata ?? {})],
  );
}
