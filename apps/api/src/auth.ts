import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { AppContext, AuthUser } from './context.js';
import { forbidden, unauthorized } from './http.js';

export const SESSION_COOKIE = 'trazo_session';
const SESSION_DAYS = 60;
const DAY_MS = 86_400_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest();
export const newToken = () => randomBytes(32).toString('base64url');

// Parámetros argon2id (OWASP 2024: m=19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);
/** Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumeración por tiempo). */
let dummyHash: Promise<string> | null = null;
export const dummyVerify = async (pw: string) => {
  dummyHash ??= hashPassword('trazo-dummy-password');
  await verifyPassword(await dummyHash, pw);
  return false;
};

export async function createSession(ctx: AppContext, userId: string, platform: string, userAgent: string | undefined) {
  const token = newToken();
  await ctx.db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token_hash: hashToken(token),
      platform: platform.slice(0, 20),
      user_agent: userAgent?.slice(0, 300) ?? null,
      expires_at: new Date(Date.now() + SESSION_DAYS * DAY_MS),
    })
    .execute();
  return token;
}

/** Plataforma cliente: los clientes nativos (Android/Windows) usan token Bearer en lugar de cookie. */
export function clientPlatform(req: FastifyRequest): 'web' | 'android' | 'windows' {
  const h = String(req.headers['x-trazo-client'] ?? 'web');
  return h === 'android' || h === 'windows' ? h : 'web';
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** Respuesta de login/registro: cookie para web, token en el cuerpo para clientes nativos. */
export async function issueSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const platform = clientPlatform(req);
  const token = await createSession(ctx, userId, platform, req.headers['user-agent']);
  if (platform === 'web') {
    setSessionCookie(ctx, reply, token);
    return {};
  }
  return { token };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('authVia', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
      req.authVia = 'bearer';
    } else if (req.cookies[SESSION_COOKIE]) {
      token = req.cookies[SESSION_COOKIE];
      req.authVia = 'cookie';
    }
    if (!token) return;

    // CSRF: con cookie, toda petición que modifica estado debe venir de un origen permitido.
    if (req.authVia === 'cookie' && !SAFE_METHODS.has(req.method) && !isAllowedOrigin(app.ctx, req)) {
      throw forbidden('Origen no permitido.');
    }

    const row = await app.ctx.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['sessions.id as sid', 'sessions.last_used_at', 'users.id', 'users.username', 'users.role'])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.expires_at', '>', sql<Date>`now()`)
      .where('users.suspended_at', 'is', null)
      .executeTakeFirst();
    if (!row) {
      req.authVia = null;
      return;
    }
    req.user = { id: row.id, username: row.username, role: row.role, sessionId: row.sid } satisfies AuthUser;
    // Sesión deslizante; como mucho una escritura por hora.
    if (Date.now() - row.last_used_at.getTime() > 3_600_000) {
      await app.ctx.db
        .updateTable('sessions')
        .set({ last_used_at: new Date(), expires_at: new Date(Date.now() + SESSION_DAYS * DAY_MS) })
        .where('id', '=', row.sid)
        .execute();
    }
  });
}

function isAllowedOrigin(ctx: AppContext, req: FastifyRequest): boolean {
  const origin = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : undefined);
  if (!origin) return false;
  if (origin === safeOrigin(ctx.config.APP_URL)) return true;
  if (ctx.config.CORS_ORIGINS.includes(origin)) return true;
  // Mismo host que la API (despliegue detrás del mismo dominio).
  const host = req.headers.host;
  return !!host && (origin === `https://${host}` || origin === `http://${host}`);
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireModerator(req: FastifyRequest): AuthUser {
  const u = requireUser(req);
  if (u.role !== 'moderator' && u.role !== 'admin') throw forbidden();
  return u;
}
