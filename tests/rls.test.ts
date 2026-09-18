// Defence in depth: bypass the HTTP layer entirely and talk to Postgres as the
// app would. Even with a buggy handler (missing WHERE, forged org context),
// row-level security must not leak or accept cross-tenant rows.
import './env.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, withTenant } from '../src/server/lib/db.ts';
import { orgIdBySlug, userIdByEmail } from './helpers.ts';

let acme: string;
let globex: string;
let bob: string; // Acme admin only
let alice: string; // Acme owner + Globex member

beforeAll(async () => {
  acme = await orgIdBySlug('acme');
  globex = await orgIdBySlug('globex');
  bob = await userIdByEmail('bob@acme.test');
  alice = await userIdByEmail('alice@acme.test');
});

const ctx = (orgId: string, userId: string) => ({ orgId, userId });

describe('Postgres row-level security', () => {
  it('an unfiltered SELECT only returns the active org’s rows', async () => {
    const orgIds = await withTenant(ctx(acme, bob), async (db) => (await db.query('SELECT DISTINCT org_id FROM projects')).rows);
    expect(orgIds).toEqual([{ org_id: acme }]);
  });

  it('forging app.org_id to an org you are NOT a member of yields nothing', async () => {
    await withTenant(ctx(globex, bob), async (db) => {
      expect((await db.query('SELECT * FROM projects')).rowCount).toBe(0);
      expect((await db.query('SELECT * FROM memberships')).rowCount).toBe(0);
      expect((await db.query('SELECT * FROM invitations')).rowCount).toBe(0);
      expect((await db.query('SELECT * FROM audit_log')).rowCount).toBe(0);
      expect((await db.query('SELECT * FROM organizations')).rowCount).toBe(0);
      // Only their own user row is visible.
      expect((await db.query('SELECT id FROM users')).rows).toEqual([{ id: bob }]);
    });
  });

  it('forged writes into a foreign org are rejected by the database', async () => {
    await expect(
      withTenant(ctx(acme, bob), (db) => db.query("INSERT INTO projects (org_id, name) VALUES ($1, 'smuggled')", [globex])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(ctx(globex, bob), (db) => db.query("INSERT INTO projects (org_id, name) VALUES ($1, 'forged ctx')", [globex])),
    ).rejects.toMatchObject({ code: '42501' });
    // Moving your own row into another tenant is also refused.
    await expect(
      withTenant(ctx(acme, bob), (db) => db.query('UPDATE projects SET org_id = $1', [globex])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('UPDATE/DELETE without a WHERE clause cannot touch another tenant', async () => {
    const before = await withTenant(ctx(globex, alice), async (db) => (await db.query('SELECT count(*)::int AS n FROM projects')).rows[0].n);
    await withTenant(ctx(acme, alice), async (db) => {
      await db.query('SAVEPOINT s');
      await db.query('DELETE FROM projects'); // oops, no WHERE
      await db.query('ROLLBACK TO SAVEPOINT s');
    });
    const after = await withTenant(ctx(globex, alice), async (db) => (await db.query('SELECT count(*)::int AS n FROM projects')).rows[0].n);
    expect(after).toBe(before);
  });

  it('a multi-org user still only sees the active org', async () => {
    const acmeNames = await withTenant(ctx(acme, alice), async (db) => (await db.query('SELECT name FROM projects')).rows.map((r) => r.name));
    const globexNames = await withTenant(ctx(globex, alice), async (db) => (await db.query('SELECT name FROM projects')).rows.map((r) => r.name));
    expect(acmeNames).toContain('Falcon Launch Site');
    expect(acmeNames).not.toContain('Brand Refresh 2026');
    expect(globexNames).toContain('Brand Refresh 2026');
    expect(globexNames).not.toContain('Falcon Launch Site');
  });

  it('no tenant context at all ⇒ no rows', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_tenant');
      expect((await client.query('SELECT * FROM projects')).rowCount).toBe(0);
      expect((await client.query('SELECT * FROM organizations')).rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('the tenant role can never read password hashes', async () => {
    await expect(withTenant(ctx(acme, bob), (db) => db.query('SELECT password_hash FROM users'))).rejects.toMatchObject({ code: '42501' });
  });

  it('the audit log is append-only for the tenant role', async () => {
    await expect(withTenant(ctx(acme, bob), (db) => db.query('DELETE FROM audit_log'))).rejects.toMatchObject({ code: '42501' });
    await expect(withTenant(ctx(acme, bob), (db) => db.query("UPDATE audit_log SET action = 'x'"))).rejects.toMatchObject({ code: '42501' });
    // ...and entries can't be written in someone else's name.
    await expect(
      withTenant(ctx(acme, bob), (db) => db.query("INSERT INTO audit_log (org_id, actor_user_id, action) VALUES ($1, $2, 'fake')", [acme, alice])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('the database itself enforces a single owner per org', async () => {
    await expect(
      withTenant(ctx(acme, alice), (db) => db.query("UPDATE memberships SET role = 'owner' WHERE user_id = $1", [bob])),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
