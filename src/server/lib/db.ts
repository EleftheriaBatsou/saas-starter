import pg from 'pg';
import { config } from '../config.ts';

export type Queryable = Pick<pg.PoolClient, 'query'>;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export interface TenantContext {
  orgId: string;
  userId: string;
}

/**
 * THE central tenant-isolation primitive.
 *
 * Runs `fn` in a transaction that has switched to the RLS-restricted
 * `app_tenant` role with the active org pinned via a transaction-local GUC.
 * Every row the callback can see or write is filtered by Postgres policies on
 * `app.org_id` — a forgotten `WHERE org_id = ...` still cannot leak another
 * tenant's data. Settings are LOCAL, so pooled connections never carry them
 * over to the next request.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_tenant');
    await client.query(
      "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
      [ctx.orgId, ctx.userId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Identity-layer transaction (login role, not tenant-restricted). Allowed
 * only for: session/user lookup (guards.ts), signup/login/password flows
 * (routes/auth.ts), invite-token lookup/acceptance (routes/invitations.ts)
 * and org creation (routes/org.ts). Tenant data goes through withTenant.
 */
export async function withSystem<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
