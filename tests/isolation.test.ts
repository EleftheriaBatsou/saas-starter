// Attempts to BREAK tenant isolation through the HTTP API. Every attack here
// must fail; the demo data has two orgs (acme, globex) and alice in both.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, orgIdBySlug, redis, switchTo, userIdByEmail, type Client } from './helpers.ts';

let acme: string;
let globex: string;
let globexProjectId: string;
let globexInviteId: string;
let frankId: string;

beforeAll(async () => {
  await redis.flushdb();
  acme = await orgIdBySlug('acme');
  globex = await orgIdBySlug('globex');
  frankId = await userIdByEmail('frank@globex.test');
  const dana = await login('dana@globex.test');
  globexProjectId = (await dana.get('/api/projects')).body.projects[0].id;
  globexInviteId = (await dana.get('/api/invitations')).body.invitations[0].id;
});

beforeEach(async () => {
  await redis.flushdb(); // reset rate-limit counters between tests
});

describe('cross-tenant access by ID (bob is only in Acme)', () => {
  let bob: Client;
  beforeEach(async () => {
    bob = await login('bob@acme.test');
  });

  it('cannot read another org’s project by id', async () => {
    const r = await bob.get(`/api/projects/${globexProjectId}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('Brand');
  });

  it('cannot update or delete another org’s project by id', async () => {
    expect((await bob.patch(`/api/projects/${globexProjectId}`, { name: 'pwned' })).status).toBe(404);
    expect((await bob.del(`/api/projects/${globexProjectId}`)).status).toBe(404);
    const dana = await login('dana@globex.test');
    const still = await dana.get(`/api/projects/${globexProjectId}`);
    expect(still.status).toBe(200);
    expect(still.body.project.name).not.toBe('pwned');
  });

  it('project list contains only the active org’s projects', async () => {
    const r = await bob.get('/api/projects');
    const names: string[] = r.body.projects.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Falcon Launch Site', 'Orbital Telemetry', 'Fuel Cell R&D']));
    expect(names).not.toContain('Brand Refresh 2026');
    expect(names).not.toContain('Holiday Campaign');
  });

  it('cannot switch the session into an org they are not a member of', async () => {
    const r = await bob.post('/api/session/active-org', { orgId: globex });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_A_MEMBER');
    expect((await bob.get(`/api/projects/${globexProjectId}`)).status).toBe(404);
  });

  it('ignores forged org ids in headers, query strings and bodies', async () => {
    // Header claiming another org is refused outright, not honoured.
    const h = await bob.get('/api/projects', { 'x-org-id': globex });
    expect(h.status).toBe(409);
    // Query param is ignored: still Acme data.
    const q = await bob.get(`/api/projects?orgId=${globex}&org_id=${globex}`);
    expect(q.body.projects.map((p: { name: string }) => p.name)).not.toContain('Brand Refresh 2026');
    // org_id in a create body is ignored: the project lands in Acme.
    const c = await bob.post('/api/projects', { name: 'Smuggled', org_id: globex, orgId: globex });
    expect(c.status).toBe(201);
    const dana = await login('dana@globex.test');
    const globexNames = (await dana.get('/api/projects')).body.projects.map((p: { name: string }) => p.name);
    expect(globexNames).not.toContain('Smuggled');
  });

  it('cannot list, re-role or remove another org’s members', async () => {
    const list = await bob.get('/api/members');
    const emails: string[] = list.body.members.map((m: { email: string }) => m.email);
    expect(emails.every((e) => e.endsWith('@acme.test'))).toBe(true);
    expect((await bob.patch(`/api/members/${frankId}`, { role: 'admin' })).status).toBe(404);
    expect((await bob.del(`/api/members/${frankId}`)).status).toBe(404);
  });

  it('cannot see, resend or revoke another org’s invitations', async () => {
    const list = await bob.get('/api/invitations');
    expect(list.body.invitations.map((i: { email: string }) => i.email)).not.toContain('xavier@globex.test');
    expect((await bob.post(`/api/invitations/${globexInviteId}/revoke`)).status).toBe(404);
    expect((await bob.post(`/api/invitations/${globexInviteId}/resend`)).status).toBe(404);
  });

  it('audit log never shows another org’s events', async () => {
    const r = await bob.get('/api/audit?limit=100');
    const targets = JSON.stringify(r.body.entries);
    expect(targets).not.toContain('globex');
    expect(targets).not.toContain('Brand Refresh');
  });

  it('malformed ids are indistinguishable from foreign ids', async () => {
    expect((await bob.get('/api/projects/not-a-uuid')).status).toBe(404);
    expect((await bob.get("/api/projects/1' OR '1'='1")).status).toBe(404);
  });
});

describe('multi-org user (alice: owner of Acme, member of Globex)', () => {
  it('sees only the ACTIVE org’s data, and switching changes the scope', async () => {
    const alice = await login('alice@acme.test');
    const me = (await alice.get('/api/me')).body;
    expect(me.activeOrgId).toBe(acme);
    expect((await alice.get(`/api/projects/${globexProjectId}`)).status).toBe(404);

    await switchTo(alice, globex);
    expect((await alice.get(`/api/projects/${globexProjectId}`)).status).toBe(200);
    const names = (await alice.get('/api/projects')).body.projects.map((p: { name: string }) => p.name);
    expect(names).not.toContain('Falcon Launch Site');
    // Her role follows the org: member in Globex, so no admin powers there.
    expect((await alice.get('/api/audit')).status).toBe(403);
    expect((await alice.post('/api/invitations', { email: 'x@y.z', role: 'member' })).status).toBe(403);
  });

  it('a stale tab rendering the old org is refused instead of writing to the new one', async () => {
    const alice = await login('alice@acme.test');
    await switchTo(alice, globex);
    const r = await alice.post('/api/projects', { name: 'Meant for Acme' }, { 'x-org-id': acme });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ORG_MISMATCH');
  });
});

describe('unauthenticated & forged sessions', () => {
  it('rejects every tenant endpoint without a session', async () => {
    const { call } = await import('./helpers.ts');
    for (const [m, u] of [
      ['GET', '/api/projects'],
      ['GET', `/api/projects/${globexProjectId}`],
      ['GET', '/api/members'],
      ['GET', '/api/audit'],
      ['POST', '/api/invitations'],
      ['DELETE', '/api/org'],
    ] as const) {
      expect((await call(m, u)).status, `${m} ${u}`).toBe(401);
    }
  });

  it('rejects a tampered / made-up session cookie', async () => {
    const { call } = await import('./helpers.ts');
    const r = await call('GET', '/api/me', { cookie: '__Host-sid=' + 'A'.repeat(43) });
    expect(r.status).toBe(401);
  });

  it('refuses cross-site state-changing requests (CSRF)', async () => {
    const bob = await login('bob@acme.test');
    const r = await bob.post('/api/projects', { name: 'csrf' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('BAD_ORIGIN');
  });
});
