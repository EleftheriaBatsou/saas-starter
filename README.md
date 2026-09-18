# Orbit — Multi-Tenant SaaS Starter

Users sign up, create or join organisations, invite teammates with roles, and see **only** their own organisation's data. Includes an admin panel with an audit log.

## Live preview

**https://appstage-249c-3000.prg1.zerops.app**

This is the staging build. It's seeded with two demo orgs, and the login page has one-click demo accounts. The password for all of them is `Demo-Pass-2026!`. Sign in as **Alice**: she owns Acme Rockets and is a member of Globex Studios, so she can use the org switcher (⌘O) to watch every view re-scope. Demo data may be reset at any time.

- **Frontend:** Vue 3 + Vite + TypeScript (`src/client`)
- **API:** Node 24 + Fastify 5 + TypeScript, run natively with Node's type stripping (`src/server`)
- **Data:** PostgreSQL (`db`) for all identity and tenant data; Valkey (`cache`) for sessions, email tokens and rate limits
- **Hosting:** Zerops. Configuration is in `zerops.yaml`.

## How tenant isolation works

1. **Row-level security is the enforcement point.** Tenant routes run inside `withTenant()` (`src/server/lib/db.ts`). It opens a transaction, runs `SET LOCAL ROLE app_tenant`, and pins `app.org_id` and `app.user_id`. Every tenant table has RLS policies (`src/server/migrations/001_init.sql`) keyed on those settings. The policies also require that the user is a member of the pinned org, so a forged org context sees nothing.
2. **The active org comes from the server-side session**, never from the URL or request body. Membership and role are re-checked on every request (`src/server/lib/guards.ts`), so removals and demotions take effect immediately.
3. **Permissions are defined in one place**: `src/shared/permissions.ts`. Every mutating endpoint declares `requirePermission('…')`. The UI uses the same table only to decide what to show.
4. **Least privilege in Postgres.** `app_tenant` cannot read `password_hash` because of a column-level grant. It can only append to `audit_log`, and it cannot write rows for another org. The database also enforces exactly one owner per org.

Only the identity layer (signup, login, invite-token lookup, org creation) uses the non-tenant `withSystem()` connection.

## Security

- **Passwords:** argon2id with a pepper (`PASSWORD_PEPPER`). The same policy is checked on the client and the server.
- **Sessions:** an opaque `__Host-sid` cookie (httpOnly, Secure, SameSite=Lax), stored in Valkey under an HMAC key. Logout, "sign out everywhere" and password reset revoke sessions instantly.
- **Rate limiting** (Valkey fixed windows):
  - login: 30 per IP per 15 min, and 5 failures per account per 15 min
  - password reset: 3 per email per hour, and 10 per IP per hour
  - also applied to signup, verification-email resends and invites
- **CSRF:** SameSite cookies, JSON-only bodies, and an Origin / Sec-Fetch-Site check.
- **Email:** verification and reset tokens are single-use, stored hashed, and expire. Invite tokens are stored as SHA-256 hashes and are bound to the invited email address.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `DATABASE_URL`, `DATABASE_ADMIN_URL`, `REDIS_URL` | `zerops.yaml` (wired from `db`/`cache`) | connections (admin URL is used for migrations only) |
| `SESSION_SECRET` | project env, **unique per project** | keys session-store entries |
| `PASSWORD_PEPPER` | project env, **unique per project** | argon2 secret |
| `APP_URL` | project env (prod) | public origin for email links and the Origin check (defaults to the Zerops subdomain) |
| `SMTP_URL` or `MAIL_WEBHOOK_URL`, `MAIL_FROM` | project env | mail delivery. In dev, links are printed to the log. |
| `SEED_DEMO` | dev project only | seeds the Acme and Globex demo orgs |

## Develop & test

```bash
npm run dev          # Fastify + Vite middleware (HMR) on :3000; migrates + seeds on boot
npm test             # 63 isolation / permission / session tests against <db>_test + Valkey DB 1
npm run typecheck    # server + shared code
scripts/smoke-isolation.sh https://<deployed-url>   # live attacks against a seeded deployment
```

Demo users (dev only): `alice@acme.test` (Acme owner and Globex member), `bob@acme.test`, `carol@acme.test`, `dana@globex.test`, `erin@globex.test`, `frank@globex.test`. The password for all of them is `Demo-Pass-2026!`.
