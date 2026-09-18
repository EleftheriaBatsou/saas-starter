// Point the app at an isolated test database (<db>_test on the same
// Postgres) and Valkey logical DB 1, so tests never touch dev data.
// Must be imported before anything from src/server.

function withDbSuffix(url: string): string {
  const u = new URL(url);
  u.pathname = `${u.pathname}_test`;
  return u.toString();
}

if (!process.env.TEST_ENV_APPLIED) {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL) {
    throw new Error('Run tests inside the appdev container (DATABASE_URL / DATABASE_ADMIN_URL required)');
  }
  process.env.BASE_DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
  process.env.DATABASE_URL = withDbSuffix(process.env.DATABASE_URL);
  process.env.DATABASE_ADMIN_URL = withDbSuffix(process.env.DATABASE_ADMIN_URL);
  process.env.REDIS_DB = '1';
  process.env.NODE_ENV = 'test';
  process.env.APP_URL = 'https://app.test';
  process.env.SEED_DEMO = 'true';
  process.env.TEST_ENV_APPLIED = '1';
}

export {};
