// Central, validated runtime configuration. Everything secret comes from env
// vars that are set per Zerops project (dev and prod never share values).

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  env: nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  databaseAdminUrl: process.env.DATABASE_ADMIN_URL ?? '',
  redisUrl: required('REDIS_URL'),
  // Signs session-store keys; rotating it logs everyone out.
  sessionSecret: required('SESSION_SECRET'),
  // argon2 "secret" (pepper). Rotating it invalidates every password hash.
  passwordPepper: required('PASSWORD_PEPPER'),
  // Public origin used for links in emails + Origin (CSRF) checks.
  appUrl: (process.env.APP_URL || process.env.zeropsSubdomain || 'http://localhost:3000').replace(/\/$/, ''),
  smtpUrl: process.env.SMTP_URL ?? '',
  mailWebhookUrl: process.env.MAIL_WEBHOOK_URL ?? '',
  mailFrom: process.env.MAIL_FROM || 'no-reply@example.com',
  seedDemo: process.env.SEED_DEMO === 'true',
  sessionTtlSeconds: 60 * 60 * 24 * 7, // sliding
  sessionAbsoluteSeconds: 60 * 60 * 24 * 30,
  inviteTtlSeconds: 60 * 60 * 24 * 7,
};

if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 chars');
if (config.passwordPepper.length < 32) throw new Error('PASSWORD_PEPPER must be at least 32 chars');
