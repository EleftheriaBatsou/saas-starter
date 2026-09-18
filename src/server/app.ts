import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { pool } from './lib/db.ts';
import { redis } from './lib/cache.ts';
import { HttpError } from './lib/errors.ts';
import authRoutes from './routes/auth.ts';
import orgRoutes from './routes/org.ts';
import projectRoutes from './routes/projects.ts';
import invitationRoutes from './routes/invitations.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(opts: { frontend?: 'vite' | 'static' | 'none' } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest ? false : { level: config.isProd ? 'info' : 'debug' },
    trustProxy: true, // behind the Zerops L7 balancer — needed for per-IP rate limits
    bodyLimit: 64 * 1024,
  });

  app.decorateRequest('session', null);
  app.decorateRequest('user', null);
  app.decorateRequest('org', null);
  app.decorateRequest('tenant', function () {
    throw new Error('req.tenant() used on a route without requireOrg/requirePermission');
  });

  await app.register(cookie);
  await app.register(helmet, {
    // Vite's dev server injects inline styles/scripts; enforce CSP for built assets only.
    contentSecurityPolicy: config.isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  // CSRF defence in depth (cookies are already SameSite=Lax and bodies must be
  // JSON): refuse state-changing requests that a browser marks as cross-site.
  const appOrigin = new URL(config.appUrl).origin;
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if ((origin && origin !== appOrigin) || site === 'cross-site') {
      throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request refused.');
    }
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    if (err instanceof HttpError) {
      if (err.headers) reply.headers(err.headers);
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, ...err.details } });
    }
    const status = err.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
  });

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    await redis.ping();
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(orgRoutes);
  await app.register(projectRoutes);
  await app.register(invitationRoutes);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
    }
    if (opts.frontend === 'static' && req.method === 'GET') return reply.sendFile('index.html');
    return reply.code(404).send('Not found');
  });

  if (opts.frontend === 'vite') {
    // Dev: Vite runs as middleware inside Fastify — one port, one origin, HMR
    // over the same socket, so the session cookie is always first-party.
    const [{ default: middie }, { createServer }] = await Promise.all([import('@fastify/middie'), import('vite')]);
    await app.register(middie);
    const vite = await createServer({
      server: { middlewareMode: true, hmr: { server: app.server }, allowedHosts: true },
      appType: 'spa',
    });
    app.use((req, res, next) => (req.url?.startsWith('/api/') ? next() : vite.middlewares(req, res, next)));
    app.addHook('onClose', async () => vite.close());
  } else if (opts.frontend === 'static') {
    const root = fileURLToPath(new URL('../../dist/client/', import.meta.url));
    if (!existsSync(root)) throw new Error(`Built client not found at ${root} — run npm run build`);
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
      setHeaders(res, path) {
        res.header('cache-control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  return app;
}
