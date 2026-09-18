-- Schema + row-level security for the multi-tenant core.
--
-- Roles:
--   * migration role (superuser)  owns every table; only used by migrate.ts.
--   * {{APP_LOGIN}}              the app's login role. Used directly ONLY by the
--                                identity layer (see withSystem in lib/db.ts):
--                                signup/login/invite-token lookup/org creation.
--   * app_tenant                 NOLOGIN role that every tenant-scoped request
--                                switches into with SET LOCAL ROLE. It is subject
--                                to the RLS policies below, keyed on the
--                                transaction-local setting app.org_id.

CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

GRANT app_tenant TO {{APP_LOGIN}} WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public TO {{APP_LOGIN}}, app_tenant;

-- Session-scoped tenant context. NULL when unset => policies match nothing.
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE CHECK (length(email) <= 254),
  password_hash     text NOT NULL,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug       citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      org_role NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);
-- Exactly one owner per org is enforced by the database, not just the API.
CREATE UNIQUE INDEX memberships_one_owner ON memberships (org_id) WHERE role = 'owner';

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        org_role NOT NULL CHECK (role <> 'owner'),
  -- SHA-256 of the emailed token; the raw token is never stored.
  token_hash  bytea NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_idx ON invitations (org_id, created_at DESC);
CREATE UNIQUE INDEX invitations_one_open ON invitations (org_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
  color       text NOT NULL DEFAULT '#7C5CFF' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_org_idx ON projects (org_id, created_at DESC);

CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target        text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, ts DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Privileges. app_tenant gets the minimum; audit_log is append-only for it,
-- and it can never read password hashes (column-level grant).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON users, organizations, memberships, invitations, projects TO {{APP_LOGIN}};
GRANT SELECT, INSERT ON audit_log TO {{APP_LOGIN}};

GRANT SELECT (id, email, name, email_verified_at, created_at) ON users TO app_tenant;
GRANT SELECT, UPDATE, DELETE ON organizations TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships, invitations, projects TO app_tenant;
GRANT SELECT, INSERT ON audit_log TO app_tenant;

-- ---------------------------------------------------------------------------
-- Row-level security.
-- ---------------------------------------------------------------------------
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;

-- Identity layer (login role): explicit, auditable full access.
CREATE POLICY system_access ON users         TO {{APP_LOGIN}} USING (true) WITH CHECK (true);
CREATE POLICY system_access ON organizations TO {{APP_LOGIN}} USING (true) WITH CHECK (true);
CREATE POLICY system_access ON memberships   TO {{APP_LOGIN}} USING (true) WITH CHECK (true);
CREATE POLICY system_access ON invitations   TO {{APP_LOGIN}} USING (true) WITH CHECK (true);
CREATE POLICY system_access ON projects      TO {{APP_LOGIN}} USING (true) WITH CHECK (true);
CREATE POLICY system_access ON audit_log     TO {{APP_LOGIN}} USING (true) WITH CHECK (true);

-- Membership gate, evaluated once per statement via (SELECT ...). SECURITY
-- DEFINER so it can read memberships without recursing into its own policy.
-- Even if application code pinned an org the user doesn't belong to, every
-- tenant policy below would match zero rows.
CREATE FUNCTION app_is_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (SELECT 1 FROM memberships
                    WHERE org_id = app_current_org() AND user_id = app_current_user())
  $$;
REVOKE ALL ON FUNCTION app_is_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_member() TO app_tenant, {{APP_LOGIN}};

-- Tenant role: everything keyed on app.org_id AND verified membership.
CREATE POLICY tenant_projects ON projects TO app_tenant
  USING (org_id = app_current_org() AND (SELECT app_is_member()))
  WITH CHECK (org_id = app_current_org() AND (SELECT app_is_member()));

CREATE POLICY tenant_invitations ON invitations TO app_tenant
  USING (org_id = app_current_org() AND (SELECT app_is_member()))
  WITH CHECK (org_id = app_current_org() AND (SELECT app_is_member()));

CREATE POLICY tenant_audit_select ON audit_log FOR SELECT TO app_tenant
  USING (org_id = app_current_org() AND (SELECT app_is_member()));
CREATE POLICY tenant_audit_insert ON audit_log FOR INSERT TO app_tenant
  WITH CHECK (org_id = app_current_org() AND (SELECT app_is_member())
              AND actor_user_id IS NOT DISTINCT FROM app_current_user());

-- Memberships are visible only inside the active org. (The org switcher's
-- "which orgs am I in" list is an identity-layer query by user id.)
CREATE POLICY tenant_memberships_select ON memberships FOR SELECT TO app_tenant
  USING (org_id = app_current_org() AND (SELECT app_is_member()));
CREATE POLICY tenant_memberships_insert ON memberships FOR INSERT TO app_tenant
  WITH CHECK (org_id = app_current_org() AND (SELECT app_is_member()));
CREATE POLICY tenant_memberships_update ON memberships FOR UPDATE TO app_tenant
  USING (org_id = app_current_org() AND (SELECT app_is_member()))
  WITH CHECK (org_id = app_current_org());
CREATE POLICY tenant_memberships_delete ON memberships FOR DELETE TO app_tenant
  USING (org_id = app_current_org() AND (SELECT app_is_member()));

CREATE POLICY tenant_orgs_select ON organizations FOR SELECT TO app_tenant
  USING (id = app_current_org() AND (SELECT app_is_member()));
CREATE POLICY tenant_orgs_update ON organizations FOR UPDATE TO app_tenant
  USING (id = app_current_org() AND (SELECT app_is_member()))
  WITH CHECK (id = app_current_org());
CREATE POLICY tenant_orgs_delete ON organizations FOR DELETE TO app_tenant
  USING (id = app_current_org() AND (SELECT app_is_member()));

-- Users are visible to the tenant role only if they are yourself or a member
-- of the active org (and you are too).
CREATE POLICY tenant_users_select ON users FOR SELECT TO app_tenant
  USING (id = app_current_user()
         OR ((SELECT app_is_member())
             AND EXISTS (SELECT 1 FROM memberships m
                          WHERE m.user_id = users.id AND m.org_id = app_current_org())));
