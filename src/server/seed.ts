// Demo data: two orgs with different people and projects, plus one user
// (alice) who belongs to BOTH, so the org switcher and isolation are easy to
// demonstrate. Idempotent — only runs when the demo orgs don't exist yet.
// Enabled with SEED_DEMO=true (dev project only; never set it in production).
import { withSystem } from './lib/db.ts';
import { hashPassword } from './lib/passwords.ts';
import { sha256, randomToken } from './lib/crypto.ts';
import type { Role } from '../shared/permissions.ts';

export const DEMO_PASSWORD = 'Demo-Pass-2026!';

export const DEMO_USERS = [
  { email: 'alice@acme.test', name: 'Alice Anders' },
  { email: 'bob@acme.test', name: 'Bob Brightwater' },
  { email: 'carol@acme.test', name: 'Carol Chen' },
  { email: 'dana@globex.test', name: 'Dana Delgado' },
  { email: 'erin@globex.test', name: 'Erin Eastwood' },
  { email: 'frank@globex.test', name: 'Frank Fischer' },
] as const;

const ORGS: {
  name: string;
  slug: string;
  members: [string, Role][];
  projects: [string, string, 'active' | 'paused' | 'done', string][];
  invites: [string, Role, 'pending' | 'revoked' | 'expired'][];
}[] = [
  {
    name: 'Acme Rockets',
    slug: 'acme',
    members: [
      ['alice@acme.test', 'owner'],
      ['bob@acme.test', 'admin'],
      ['carol@acme.test', 'member'],
    ],
    projects: [
      ['Falcon Launch Site', 'Pad construction, permits and range safety sign-off.', 'active', '#7C5CFF'],
      ['Orbital Telemetry', 'Ground-station dashboards for stage separation data.', 'active', '#0D99FF'],
      ['Fuel Cell R&D', 'Next-gen methalox injector testing.', 'paused', '#FF5C7C'],
    ],
    invites: [
      ['zoe@acme.test', 'member', 'pending'],
      ['yuri@acme.test', 'admin', 'revoked'],
    ],
  },
  {
    name: 'Globex Studios',
    slug: 'globex',
    members: [
      ['dana@globex.test', 'owner'],
      ['erin@globex.test', 'admin'],
      ['frank@globex.test', 'member'],
      ['alice@acme.test', 'member'],
    ],
    projects: [
      ['Brand Refresh 2026', 'New logo system, type scale and motion guidelines.', 'active', '#15D7C4'],
      ['Holiday Campaign', 'Cross-channel launch for the winter collection.', 'active', '#FFC93C'],
      ['Podcast Season 3', 'Twelve episodes, guest booking and edit pipeline.', 'done', '#2BD968'],
      ['Mobile App v2', 'Rebuild onboarding and the offline mode.', 'active', '#7C5CFF'],
    ],
    invites: [
      ['xavier@globex.test', 'member', 'pending'],
      ['wanda@globex.test', 'member', 'expired'],
    ],
  },
];

export async function seedDemo(log = console.log): Promise<void> {
  const exists = await withSystem((db) => db.query("SELECT 1 FROM organizations WHERE slug IN ('acme', 'globex')"));
  if (exists.rowCount) {
    log('seed: demo orgs already present, skipping');
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await withSystem(async (db) => {
    const userIds = new Map<string, string>();
    for (const u of DEMO_USERS) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [u.email, u.name, passwordHash],
      );
      userIds.set(u.email, rows[0]!.id);
    }
    for (const org of ORGS) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, created_at) VALUES ($1, $2, now() - interval '30 days') RETURNING id`,
        [org.name, org.slug],
      );
      const orgId = rows[0]!.id;
      const ownerId = userIds.get(org.members[0]![0])!;
      let day = 30;
      for (const [email, role] of org.members) {
        await db.query(
          `INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))`,
          [orgId, userIds.get(email), role, day],
        );
        await db.query(
          `INSERT INTO audit_log (org_id, actor_user_id, action, target, metadata, ts)
           VALUES ($1, $2, $3, $4, $5, now() - make_interval(days => $6))`,
          [orgId, userIds.get(email), role === 'owner' ? 'org.created' : 'member.joined', email, JSON.stringify({ role }), day],
        );
        day -= 3;
      }
      for (const [name, description, status, color] of org.projects) {
        await db.query(
          `INSERT INTO projects (org_id, name, description, status, color, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(days => $7))`,
          [orgId, name, description, status, color, ownerId, day],
        );
        await db.query(
          `INSERT INTO audit_log (org_id, actor_user_id, action, target, metadata, ts)
           VALUES ($1, $2, 'project.created', $3, '{}', now() - make_interval(days => $4))`,
          [orgId, ownerId, name, day],
        );
        day -= 2;
      }
      for (const [email, role, state] of org.invites) {
        await db.query(
          `INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at, revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orgId,
            email,
            role,
            sha256(randomToken()),
            ownerId,
            state === 'expired' ? new Date(Date.now() - 86_400_000) : new Date(Date.now() + 6 * 86_400_000),
            state === 'revoked' ? new Date() : null,
          ],
        );
      }
    }
  });
  log(`seed: created demo orgs acme + globex (password for all demo users: ${DEMO_PASSWORD})`);
}
