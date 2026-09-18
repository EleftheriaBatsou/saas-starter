import './env.ts';
import { buildApp } from '../src/server/app.ts';
import { withSystem } from '../src/server/lib/db.ts';
import { redis } from '../src/server/lib/cache.ts';
import { hashPassword } from '../src/server/lib/passwords.ts';
import { randomToken, sha256 } from '../src/server/lib/crypto.ts';
import { DEMO_PASSWORD } from '../src/server/seed.ts';
import { outbox } from '../src/server/lib/mailer.ts';
import type { Role } from '../src/shared/permissions.ts';

export { outbox, DEMO_PASSWORD, redis };

export const app = await buildApp({ frontend: 'none' });

export interface Res {
  status: number;
  body: any;
  cookie?: string;
}

function cookieFrom(setCookie: string | string[] | undefined): string | undefined {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return first?.split(';')[0];
}

export async function call(method: string, url: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await app.inject({
    method: method as 'GET',
    url,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as object } : method === 'GET' ? {} : { payload: {} }),
  });
  let body: unknown = res.body;
  try {
    body = res.json();
  } catch {}
  return { status: res.statusCode, body, cookie: cookieFrom(res.headers['set-cookie']) };
}

/** An authenticated client bound to one session cookie. */
export function as(cookie: string) {
  return {
    cookie,
    get: (url: string, headers?: Record<string, string>) => call('GET', url, { cookie, headers }),
    post: (url: string, body: unknown = {}, headers?: Record<string, string>) => call('POST', url, { cookie, body, headers }),
    patch: (url: string, body: unknown) => call('PATCH', url, { cookie, body }),
    del: (url: string, body: unknown = {}) => call('DELETE', url, { cookie, body }),
  };
}
export type Client = ReturnType<typeof as>;

export async function login(email: string, password = DEMO_PASSWORD): Promise<Client> {
  const res = await call('POST', '/api/auth/login', { body: { email, password } });
  if (res.status !== 200 || !res.cookie) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return as(res.cookie);
}

export async function switchTo(client: Client, orgId: string) {
  const r = await client.post('/api/session/active-org', { orgId });
  if (r.status !== 200) throw new Error(`switch failed ${r.status}`);
}

let hash: Promise<string> | null = null;
let seq = 0;
const run = Date.now().toString(36);

export async function makeUser(label: string, opts: { verified?: boolean } = {}) {
  hash ??= hashPassword(DEMO_PASSWORD);
  const passwordHash = await hash;
  const email = `${label}.${run}.${++seq}@test.local`;
  const { rows } = await withSystem((db) =>
    db.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, ${opts.verified === false ? 'NULL' : 'now()'}) RETURNING id`,
      [email, `${label[0]!.toUpperCase()}${label.slice(1)} Tester`, passwordHash],
    ),
  );
  return { id: rows[0]!.id, email };
}

/** Fresh org with one user per requested role — lets tests mutate freely. */
export async function makeOrg(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const admin = await makeUser(`${label}-admin`);
  const member = await makeUser(`${label}-member`);
  const slug = `${label}-${run}-${++seq}`.toLowerCase().slice(0, 40).replace(/-+$/, '');
  const orgId = await withSystem(async (db) => {
    const { rows } = await db.query<{ id: string }>('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [`${label} Org`, slug]);
    const id = rows[0]!.id;
    for (const [u, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'member']] as const) {
      await db.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [id, u.id, role]);
    }
    await db.query("INSERT INTO projects (org_id, name) VALUES ($1, 'Secret project of ' || $2)", [id, label]);
    return id;
  });
  return { orgId, slug, owner, admin, member };
}

export async function orgIdBySlug(slug: string): Promise<string> {
  const { rows } = await withSystem((db) => db.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [slug]));
  return rows[0]!.id;
}

export async function userIdByEmail(email: string): Promise<string> {
  const { rows } = await withSystem((db) => db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]));
  return rows[0]!.id;
}

/** Insert an invitation directly and return its raw token. */
export async function makeInvite(orgId: string, email: string, role: Role, opts: { expired?: boolean; revoked?: boolean } = {}) {
  const token = randomToken();
  await withSystem((db) =>
    db.query(
      `INSERT INTO invitations (org_id, email, role, token_hash, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, $6)`,
      [orgId, email, role, sha256(token), opts.expired ? '-1' : '48', opts.revoked ? new Date() : null],
    ),
  );
  return token;
}

export function tokenFromLink(link: string | undefined): string {
  if (!link) throw new Error('no link');
  const u = new URL(link);
  return u.searchParams.get('token') ?? u.pathname.split('/').pop()!;
}
