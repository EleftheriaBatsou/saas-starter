// Role enforcement: every mutating endpoint is checked server-side, no
// matter what the UI shows.
import { beforeEach, describe, expect, it } from 'vitest';
import { login, makeOrg, redis, switchTo, type Client } from './helpers.ts';

beforeEach(async () => {
  await redis.flushdb();
});

async function setup() {
  const org = await makeOrg('perm');
  const owner = await login(org.owner.email);
  const admin = await login(org.admin.email);
  const member = await login(org.member.email);
  for (const c of [owner, admin, member]) await switchTo(c, org.orgId);
  const projectId = (await owner.get('/api/projects')).body.projects[0].id as string;
  return { org, owner, admin, member, projectId };
}

describe('member cannot perform admin-only actions', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  let m: Client;
  beforeEach(async () => {
    s = await setup();
    m = s.member;
  });

  it.each([
    ['invite people', () => m.post('/api/invitations', { email: 'new@x.io', role: 'member' })],
    ['list invitations', () => m.get('/api/invitations')],
    ['change a role', () => m.patch(`/api/members/${s.org.admin.id}`, { role: 'member' })],
    ['promote themselves', () => m.patch(`/api/members/${s.org.member.id}`, { role: 'admin' })],
    ['remove a member', () => m.del(`/api/members/${s.org.admin.id}`)],
    ['rename the org', () => m.patch('/api/org', { name: 'Hijacked' })],
    ['delete the org', () => m.del('/api/org', { confirm: s.org.slug })],
    ['transfer ownership', () => m.post('/api/org/transfer', { userId: s.org.member.id })],
    ['read the audit log', () => m.get('/api/audit')],
    ['delete a project', () => m.del(`/api/projects/${s.projectId}`)],
  ])('403: %s', async (_label, attempt) => {
    const r = await attempt();
    expect(r.status).toBe(403);
  });

  it('...but can use the app (create/update projects, see teammates)', async () => {
    expect((await m.post('/api/projects', { name: 'Member work' })).status).toBe(201);
    expect((await m.patch(`/api/projects/${s.projectId}`, { status: 'done' })).status).toBe(200);
    expect((await m.get('/api/members')).status).toBe(200);
  });

  it('nothing changed after the failed attempts', async () => {
    const org = (await s.owner.get('/api/org')).body.org;
    expect(org.name).toBe('perm Org');
    const roles = (await s.owner.get('/api/members')).body.members.map((x: { role: string }) => x.role).sort();
    expect(roles).toEqual(['admin', 'member', 'owner']);
  });
});

describe('admin cannot perform owner-only actions or escalate', () => {
  it('cannot delete the org or transfer ownership', async () => {
    const s = await setup();
    expect((await s.admin.del('/api/org', { confirm: s.org.slug })).status).toBe(403);
    expect((await s.admin.post('/api/org/transfer', { userId: s.org.admin.id })).status).toBe(403);
  });

  it('cannot demote or remove the owner', async () => {
    const s = await setup();
    expect((await s.admin.patch(`/api/members/${s.org.owner.id}`, { role: 'member' })).status).toBe(403);
    expect((await s.admin.del(`/api/members/${s.org.owner.id}`)).status).toBe(403);
  });

  it('cannot make anyone (incl. themselves) owner, nor change their own role', async () => {
    const s = await setup();
    expect((await s.admin.patch(`/api/members/${s.org.member.id}`, { role: 'owner' })).status).toBe(403);
    expect((await s.admin.patch(`/api/members/${s.org.admin.id}`, { role: 'owner' })).status).toBe(403);
    expect((await s.admin.patch(`/api/members/${s.org.admin.id}`, { role: 'member' })).status).toBe(403);
  });

  it('cannot invite someone as owner', async () => {
    const s = await setup();
    const r = await s.admin.post('/api/invitations', { email: 'boss@x.io', role: 'owner' });
    expect(r.status).toBe(400);
  });

  it('CAN manage members below owner (the allowed path works)', async () => {
    const s = await setup();
    expect((await s.admin.patch(`/api/members/${s.org.member.id}`, { role: 'admin' })).status).toBe(200);
    expect((await s.admin.patch(`/api/members/${s.org.member.id}`, { role: 'member' })).status).toBe(200);
    expect((await s.admin.post('/api/invitations', { email: 'hire@x.io', role: 'member' })).status).toBe(201);
  });
});

describe('owner powers & invariants', () => {
  it('transfer ownership keeps exactly one owner and demotes the old one to admin', async () => {
    const s = await setup();
    expect((await s.owner.post('/api/org/transfer', { userId: s.org.member.id })).status).toBe(200);
    const members = (await s.owner.get('/api/members')).body.members as { id: string; role: string }[];
    expect(members.filter((x) => x.role === 'owner').map((x) => x.id)).toEqual([s.org.member.id]);
    expect(members.find((x) => x.id === s.org.owner.id)!.role).toBe('admin');
    // Old owner lost owner-only powers immediately.
    expect((await s.owner.del('/api/org', { confirm: s.org.slug })).status).toBe(403);
  });

  it('owner cannot leave without transferring', async () => {
    const s = await setup();
    const r = await s.owner.post('/api/org/leave');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('OWNER_CANNOT_LEAVE');
  });

  it('delete requires typing the slug, then removes everything', async () => {
    const s = await setup();
    expect((await s.owner.del('/api/org', { confirm: 'wrong' })).status).toBe(400);
    expect((await s.owner.del('/api/org', { confirm: s.org.slug })).status).toBe(200);
    // Other members' sessions immediately lose access to the deleted org.
    const r = await s.member.get('/api/projects');
    expect(r.status).toBe(403);
  });

  it('every mutation is written to the audit log', async () => {
    const s = await setup();
    await s.owner.patch('/api/org', { name: 'Renamed Org' });
    await s.owner.patch(`/api/members/${s.org.member.id}`, { role: 'admin' });
    await s.member.post('/api/projects', { name: 'Audited' });
    const actions = (await s.owner.get('/api/audit')).body.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['org.updated', 'member.role_changed', 'project.created']));
  });
});
