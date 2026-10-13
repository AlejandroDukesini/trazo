import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerAuth } from './auth.js';
import type { AppContext } from './context.js';
import { HttpError } from './http.js';
import { activityRoutes } from './routes/activities.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { clubRoutes } from './routes/clubs.js';
import { geoRoutes } from './routes/geo.js';
import { meRoutes } from './routes/me.js';
import { plannedRouteRoutes } from './routes/routes.js';
import { segmentRoutes } from './routes/segments.js';
import { socialRoutes } from './routes/social.js';
import { trainingRoutes } from './routes/training.js';

export async function buildApp(ctx: AppContext, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    logger: opts.logger ?? {
      level: ctx.config.NODE_ENV === 'production' ? 'info' : 'debug',
      // Nunca registrar credenciales.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    ...opts,
  });
  app.decorate('ctx', ctx);

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, ctx.config.CORS_ORIGINS.includes(origin) || origin === new URL(ctx.config.APP_URL).origin);
    },
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-trazo-client'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: ctx.config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.user?.id ?? req.ip,
    errorResponseBuilder: (_req, c) => ({ statusCode: 429, error: 'rate_limited', message: `Demasiadas peticiones. Espera ${Math.ceil(c.ttl / 1000)} s.` }),
  });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 429) return reply.code(429).send(err);
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message });
    }
    req.log.error({ err }, 'Error no controlado');
    return reply.code(500).send({ error: 'internal_error', message: 'Se ha producido un error inesperado.' });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Ruta no encontrada.' }));

  await app.register(
    async (api) => {
      registerAuth(api);
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(activityRoutes);
      await api.register(socialRoutes);
      await api.register(clubRoutes);
      await api.register(segmentRoutes);
      await api.register(trainingRoutes);
      await api.register(plannedRouteRoutes);
      await api.register(geoRoutes);
      await api.register(billingRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
