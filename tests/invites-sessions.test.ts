// Invitation lifecycle, session revocation and brute-force protection.
import { beforeEach, describe, expect, it } from 'vitest';
import { call, as, login, makeInvite, makeOrg, makeUser, outbox, redis, switchTo, tokenFromLink, DEMO_PASSWORD } from './helpers.ts';

beforeEach(async () => {
  await redis.flushdb();
  outbox.length = 0;
});

describe('invitations', () => {
  it('an EXPIRED invite cannot be accepted (existing or new user)', async () => {
    const org = await makeOrg('inv-exp');
    const invitee = await makeUser('late');
    const token = await makeInvite(org.orgId, invitee.email, 'member', { expired: true });
    const c = await login(invitee.email);
    const r = await c.post('/api/invites/accept', { token });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('INVITE_EXPIRED');

    const token2 = await makeInvite(org.orgId, 'brand-new@late.io', 'member', { expired: true });
    const s = await call('POST', '/api/auth/signup', { body: { name: 'New', email: 'brand-new@late.io', password: 'Correct-Horse-9!', inviteToken: token2 } });
    expect(s.status).toBe(410);
    // The whole signup rolled back — no orphan account was created.
    expect((await call('POST', '/api/auth/login', { body: { email: 'brand-new@late.io', password: 'Correct-Horse-9!' } })).status).toBe(401);
    // And the invitee has no access to the org.
    expect((await c.post('/api/session/active-org', { orgId: org.orgId })).status).toBe(403);
  });

  it('a REVOKED invite cannot be accepted', async () => {
    const org = await makeOrg('inv-rev');
    const admin = await login(org.admin.email);
    await switchTo(admin, org.orgId);
    const invitee = await makeUser('revoked');
    const created = await admin.post('/api/invitations', { email: invitee.email, role: 'member' });
    expect(created.status).toBe(201);
    const token = tokenFromLink(created.body.devInviteUrl);
    expect((await admin.post(`/api/invitations/${created.body.invitation.id}/revoke`)).status).toBe(200);
    const r = await (await login(invitee.email)).post('/api/invites/accept', { token });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('INVITE_REVOKED');
  });

  it('an invite can only be used once', async () => {
    const org = await makeOrg('inv-once');
    const invitee = await makeUser('once');
    const token = await makeInvite(org.orgId, invitee.email, 'member');
    const c = await login(invitee.email);
    expect((await c.post('/api/invites/accept', { token })).status).toBe(200);
    const again = await c.post('/api/invites/accept', { token });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVITE_USED');
  });

  it('an invite for someone else’s email cannot be hijacked', async () => {
    const org = await makeOrg('inv-steal');
    const token = await makeInvite(org.orgId, 'intended@victim.io', 'admin');
    const attacker = await makeUser('attacker');
    const r = await (await login(attacker.email)).post('/api/invites/accept', { token });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INVITE_EMAIL_MISMATCH');
    // Nor via signup with a different address.
    const s = await call('POST', '/api/auth/signup', { body: { name: 'A', email: 'other@attacker.io', password: 'Correct-Horse-9!', inviteToken: token } });
    expect(s.status).toBe(403);
  });

  it('a garbage token is rejected', async () => {
    const u = await makeUser('garbage');
    const r = await (await login(u.email)).post('/api/invites/accept', { token: 'nope' });
    expect(r.status).toBe(404);
  });

  it('happy path — NEW user: signup via invite creates a verified member with the invited role', async () => {
    const org = await makeOrg('inv-new');
    const owner = await login(org.owner.email);
    await switchTo(owner, org.orgId);
    const created = await owner.post('/api/invitations', { email: 'newbie@join.io', role: 'admin' });
    const token = tokenFromLink(outbox.at(-1)!.link);
    expect(outbox.at(-1)!.to).toBe('newbie@join.io');
    const preview = await call('GET', `/api/invites/preview?token=${token}`);
    expect(preview.body).toMatchObject({ status: 'pending', accountExists: false, role: 'admin' });
    const s = await call('POST', '/api/auth/signup', { body: { name: 'Newbie', email: 'newbie@join.io', password: 'Correct-Horse-9!', inviteToken: token } });
    expect(s.status).toBe(201);
    const me = (await as(s.cookie!).get('/api/me')).body;
    expect(me.activeOrgId).toBe(org.orgId);
    expect(me.role).toBe('admin');
    expect(me.user.emailVerifiedAt).not.toBeNull();
    expect(created.status).toBe(201);
  });

  it('happy path — EXISTING user accepts and gains exactly the invited role', async () => {
    const org = await makeOrg('inv-old');
    const existing = await makeUser('existing');
    const token = await makeInvite(org.orgId, existing.email, 'member');
    expect((await call('GET', `/api/invites/preview?token=${token}`)).body.accountExists).toBe(true);
    const c = await login(existing.email);
    expect((await c.post('/api/invites/accept', { token })).status).toBe(200);
    const me = (await c.get('/api/me')).body;
    expect(me.activeOrgId).toBe(org.orgId);
    expect(me.role).toBe('member');
  });

  it('cannot invite someone who is already a member, or double-invite', async () => {
    const org = await makeOrg('inv-dup');
    const owner = await login(org.owner.email);
    await switchTo(owner, org.orgId);
    expect((await owner.post('/api/invitations', { email: org.member.email, role: 'member' })).status).toBe(409);
    expect((await owner.post('/api/invitations', { email: 'dup@x.io', role: 'member' })).status).toBe(201);
    expect((await owner.post('/api/invitations', { email: 'dup@x.io', role: 'member' })).status).toBe(409);
  });

  it('unverified users cannot send invites', async () => {
    const org = await makeOrg('inv-unv');
    const unverified = await makeUser('unverified', { verified: false });
    const { withSystem } = await import('../src/server/lib/db.ts');
    await withSystem((db) => db.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')", [org.orgId, unverified.id]));
    const c = await login(unverified.email);
    await switchTo(c, org.orgId);
    const r = await c.post('/api/invitations', { email: 'spam@x.io', role: 'member' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('sessions & revocation', () => {
  it('a logged-out (revoked) session cookie is dead immediately', async () => {
    const u = await makeUser('logout');
    const c = await login(u.email);
    expect((await c.get('/api/me')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).status).toBe(401);
    expect((await c.get('/api/projects')).status).toBe(401);
  });

  it('"sign out everywhere" revokes all of the user’s sessions', async () => {
    const u = await makeUser('everywhere');
    const laptop = await login(u.email);
    const phone = await login(u.email);
    expect((await laptop.post('/api/auth/logout-all')).body.revoked).toBe(2);
    expect((await phone.get('/api/me')).status).toBe(401);
    expect((await laptop.get('/api/me')).status).toBe(401);
  });

  it('password reset revokes every existing session and the token is single-use', async () => {
    const u = await makeUser('reset');
    const old = await login(u.email);
    await call('POST', '/api/auth/password/forgot', { body: { email: u.email } });
    const token = tokenFromLink(outbox.at(-1)!.link);
    const r = await call('POST', '/api/auth/password/reset', { body: { token, password: 'Brand-New-Pass-42' } });
    expect(r.status).toBe(200);
    expect((await old.get('/api/me')).status).toBe(401);
    expect((await call('POST', '/api/auth/password/reset', { body: { token, password: 'Another-Pass-43!' } })).status).toBe(400);
    expect((await call('POST', '/api/auth/login', { body: { email: u.email, password: DEMO_PASSWORD } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: u.email, password: 'Brand-New-Pass-42' } })).status).toBe(200);
  });

  it('a removed member loses org access on their very next request', async () => {
    const org = await makeOrg('removed');
    const owner = await login(org.owner.email);
    const member = await login(org.member.email);
    await switchTo(owner, org.orgId);
    await switchTo(member, org.orgId);
    expect((await member.get('/api/projects')).status).toBe(200);
    expect((await owner.del(`/api/members/${org.member.id}`)).status).toBe(200);
    const r = await member.get('/api/projects');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_A_MEMBER');
  });

  it('a demoted admin loses admin powers on their very next request', async () => {
    const org = await makeOrg('demoted');
    const owner = await login(org.owner.email);
    const admin = await login(org.admin.email);
    await switchTo(owner, org.orgId);
    await switchTo(admin, org.orgId);
    expect((await admin.get('/api/audit')).status).toBe(200);
    await owner.patch(`/api/members/${org.admin.id}`, { role: 'member' });
    expect((await admin.get('/api/audit')).status).toBe(403);
  });

  it('password reset request does not reveal whether an account exists', async () => {
    const a = await call('POST', '/api/auth/password/forgot', { body: { email: 'nobody@nowhere.io' } });
    const u = await makeUser('exists');
    const b = await call('POST', '/api/auth/password/forgot', { body: { email: u.email } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });
});

describe('brute-force protection (Valkey rate limits)', () => {
  it('locks an account after 5 failed logins — even the right password is refused', async () => {
    const u = await makeUser('brute');
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/api/auth/login', { body: { email: u.email, password: `wrong-${i}` } })).status).toBe(401);
    }
    const locked = await call('POST', '/api/auth/login', { body: { email: u.email, password: DEMO_PASSWORD } });
    expect(locked.status).toBe(429);
    expect(Number(locked.body.error.retryAfter)).toBeGreaterThan(0);
  });

  it('limits password-reset emails per address', async () => {
    const u = await makeUser('resetspam');
    for (let i = 0; i < 3; i++) expect((await call('POST', '/api/auth/password/forgot', { body: { email: u.email } })).status).toBe(200);
    expect((await call('POST', '/api/auth/password/forgot', { body: { email: u.email } })).status).toBe(429);
    expect(outbox.filter((m) => m.to === u.email)).toHaveLength(3);
  });

  it('enforces the password policy server-side', async () => {
    const r = await call('POST', '/api/auth/signup', { body: { name: 'Weak', email: 'weak@x.io', password: 'password123' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('WEAK_PASSWORD');
  });

  it('stores passwords as argon2id hashes, never plaintext', async () => {
    const { withSystem } = await import('../src/server/lib/db.ts');
    const u = await makeUser('hashcheck');
    const { rows } = await withSystem((db) => db.query('SELECT password_hash FROM users WHERE id = $1', [u.id]));
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(DEMO_PASSWORD);
  });
});
