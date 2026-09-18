import { config } from './config.ts';
import { buildApp } from './app.ts';
import { pool } from './lib/db.ts';
import { redis } from './lib/cache.ts';

if (!config.isProd) {
  // Dev: apply migrations + seed on boot so a fresh environment "just works".
  const { migrate } = await import('./migrate.ts');
  await migrate(config.databaseAdminUrl, config.databaseUrl);
  if (config.seedDemo) {
    const { seedDemo } = await import('./seed.ts');
    await seedDemo();
  }
}

const app = await buildApp({ frontend: config.isProd ? 'static' : 'vite' });
await app.listen({ host: '0.0.0.0', port: config.port });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
}
