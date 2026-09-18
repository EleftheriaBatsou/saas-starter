// Single source of truth for roles & permissions. The server enforces these on
// every endpoint; the client only uses them to decide what to show.

export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Role[] = ['owner', 'admin', 'member'];
const MANAGERS: readonly Role[] = ['owner', 'admin'];
const OWNER: readonly Role[] = ['owner'];

export const PERMISSIONS = {
  'project:read': ALL,
  'project:create': ALL,
  'project:update': ALL,
  'project:delete': MANAGERS,
  'member:read': ALL,
  'member:manage': MANAGERS,
  'invite:manage': MANAGERS,
  'org:update': MANAGERS,
  'audit:read': MANAGERS,
  'org:delete': OWNER,
  'org:transfer': OWNER,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

/** Roles an actor may hand out via invite or role change. Owner is only ever transferred. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === 'owner' || actor === 'admin') return ['admin', 'member'];
  return [];
}

/**
 * Hierarchy rule for changing / removing someone else's membership:
 * you can only act on people strictly below the owner, never on yourself,
 * and never on someone ranked above you.
 */
export function canActOnMember(actor: Role, actorId: string, target: Role, targetId: string): boolean {
  if (actorId === targetId) return false;
  if (target === 'owner') return false;
  if (!can(actor, 'member:manage')) return false;
  return RANK[actor] >= RANK[target];
}
