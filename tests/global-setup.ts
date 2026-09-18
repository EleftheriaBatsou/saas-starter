import './env.ts';
import pg from 'pg';

// Recreate the test database from scratch and apply migrations + demo seed.
export default async function setup() {
  const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  const admin = new pg.Client(process.env.BASE_DATABASE_ADMIN_URL);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(dbName)} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(dbName)}`);
  await admin.end();

  const { migrate } = await import('../src/server/migrate.ts');
  await migrate(process.env.DATABASE_ADMIN_URL!, process.env.DATABASE_URL!, () => {});
  const { seedDemo } = await import('../src/server/seed.ts');
  await seedDemo(() => {});
  const { pool } = await import('../src/server/lib/db.ts');
  const { redis } = await import('../src/server/lib/cache.ts');
  await redis.flushdb();
  await pool.end();
  redis.disconnect();
}
