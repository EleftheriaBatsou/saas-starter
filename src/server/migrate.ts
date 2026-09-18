// Applies SQL migrations as the database superuser (tables are owned by it,
// so the app's login role never owns — and can never bypass RLS on — tenant
// tables), then optionally seeds demo data.
//
//   node src/server/migrate.ts          (run by initCommands on every deploy, once per version)
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function migrate(adminUrl: string, appUrl: string, log = console.log): Promise<void> {
  const appLogin = new URL(appUrl).username;
  if (!appLogin) throw new Error('Cannot determine app login role from DATABASE_URL');
  const client = new pg.Client(adminUrl);
  await client.connect();
  try {
    // Serialise concurrent runners (multiple containers starting at once).
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const dir = fileURLToPath(new URL('./migrations/', import.meta.url));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = (await readFile(dir + file, 'utf8')).replaceAll('{{APP_LOGIN}}', client.escapeIdentifier(appLogin));
      log(`migrate: applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    log('migrate: up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) throw new Error('DATABASE_ADMIN_URL and DATABASE_URL are required');
  await migrate(adminUrl, appUrl);
  if (process.env.SEED_DEMO === 'true') {
    const { seedDemo } = await import('./seed.ts');
    await seedDemo();
  }
  const { pool } = await import('./lib/db.ts');
  const { redis } = await import('./lib/cache.ts');
  await pool.end();
  redis.disconnect();
}
