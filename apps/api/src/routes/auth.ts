import { LoginSchema, PasswordSchema, RegisterSchema } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  SESSION_COOKIE, dummyVerify, hashPassword, hashToken, issueSession, newToken, requireUser, verifyPassword,
} from '../auth.js';
import type { User } from '../db/types.js';
import { HttpError, badRequest, conflict, parse } from '../http.js';
import { getEntitlements } from '../services/entitlements.js';
import { avatarUrl } from '../services/social.js';

export function meDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    location: u.location,
    avatarUrl: avatarUrl(u.id, u.avatar_path, u.updated_at),
    isPrivate: u.is_private,
    units: u.units,
    defaultVisibility: u.default_visibility,
    weightKg: u.weight_kg,
    hrMax: u.hr_max,
    hrRest: u.hr_rest,
    ftp: u.ftp,
    role: u.role,
    createdAt: u.created_at.toISOString(),
  };
}

const RESET_TTL_MS = 60 * 60 * 1000;

export async function authRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const strict = { config: { rateLimit: { max: ctx.config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } } };

  app.post('/auth/register', strict, async (req, reply) => {
    const input = parse(RegisterSchema, req.body);
    const exists = await ctx.db
      .selectFrom('users')
      .select(['email', 'username'])
      .where((eb) => eb.or([eb('email', '=', input.email), eb('username', '=', input.username)]))
      .execute();
    if (exists.some((e) => e.username.toLowerCase() === input.username)) throw conflict('username_taken', 'Ese nombre de usuario ya existe.');
    if (exists.length) throw conflict('email_taken', 'Ya existe una cuenta con ese correo.');
    const user = await ctx.db
      .insertInto('users')
      .values({ email: input.email, username: input.username, display_name: input.displayName, password_hash: await hashPassword(input.password) })
      .returningAll()
      .executeTakeFirstOrThrow();
    const session = await issueSession(ctx, req, reply, user.id);
    reply.code(201);
    return { user: meDto(user), entitlements: await getEntitlements(ctx, user.id), ...session };
  });

  app.post('/auth/login', strict, async (req, reply) => {
    const input = parse(LoginSchema, req.body);
    const user = await ctx.db.selectFrom('users').selectAll().where('email', '=', input.email).executeTakeFirst();
    const ok = user ? await verifyPassword(user.password_hash, input.password) : await dummyVerify(input.password);
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.');
    if (user.suspended_at) throw new HttpError(403, 'suspended', 'Esta cuenta está suspendida.');
    const session = await issueSession(ctx, req, reply, user.id);
    return { user: meDto(user), entitlements: await getEntitlements(ctx, user.id), ...session };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.user) await ctx.db.deleteFrom('sessions').where('id', '=', req.user.sessionId).execute();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/session', async (req) => {
    const u = requireUser(req);
    const user = await ctx.db.selectFrom('users').selectAll().where('id', '=', u.id).executeTakeFirstOrThrow();
    return { user: meDto(user), entitlements: await getEntitlements(ctx, u.id) };
  });

  app.get('/auth/sessions', async (req) => {
    const u = requireUser(req);
    const rows = await ctx.db
      .selectFrom('sessions')
      .select(['id', 'platform', 'user_agent', 'created_at', 'last_used_at'])
      .where('user_id', '=', u.id)
      .where('expires_at', '>', sql<Date>`now()`)
      .orderBy('last_used_at', 'desc')
      .execute();
    return rows.map((r) => ({ id: r.id, platform: r.platform, userAgent: r.user_agent, createdAt: r.created_at, lastUsedAt: r.last_used_at, current: r.id === u.sessionId }));
  });

  app.delete('/auth/sessions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await ctx.db.deleteFrom('sessions').where('id', '=', id).where('user_id', '=', u.id).execute();
    return { ok: true };
  });

  app.post('/auth/password', strict, async (req) => {
    const u = requireUser(req);
    const input = parse(z.object({ current: z.string().min(1).max(200), next: PasswordSchema }), req.body);
    const user = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', u.id).executeTakeFirstOrThrow();
    if (!(await verifyPassword(user.password_hash, input.current))) throw badRequest('invalid_password', 'La contraseña actual no es correcta.');
    await ctx.db.updateTable('users').set({ password_hash: await hashPassword(input.next), updated_at: new Date() }).where('id', '=', u.id).execute();
    // Cierra el resto de sesiones.
    await ctx.db.deleteFrom('sessions').where('user_id', '=', u.id).where('id', '<>', u.sessionId).execute();
    return { ok: true };
  });

  app.post('/auth/password-reset/request', strict, async (req, reply) => {
    const { email } = parse(z.object({ email: z.email().transform((e) => e.toLowerCase()) }), req.body);
    const user = await ctx.db.selectFrom('users').select(['id', 'email']).where('email', '=', email).executeTakeFirst();
    if (user) {
      const token = newToken();
      await ctx.db.insertInto('password_resets').values({ token_hash: hashToken(token), user_id: user.id, expires_at: new Date(Date.now() + RESET_TTL_MS) }).execute();
      const link = `${ctx.config.APP_URL}/restablecer?token=${token}`;
      try {
        await ctx.mailer.send({
          to: user.email,
          subject: 'Restablece tu contraseña de Trazo',
          text: `Hola,\n\nPara elegir una nueva contraseña abre este enlace (caduca en 1 hora):\n${link}\n\nSi no lo has pedido, ignora este correo.`,
        });
      } catch (err) {
        req.log.error({ err }, 'No se pudo enviar el correo de recuperación');
        throw new HttpError(503, 'mail_unavailable', 'No se ha podido enviar el correo. Inténtalo más tarde.');
      }
    }
    // Misma respuesta exista o no la cuenta (no revela qué correos están registrados).
    reply.code(202);
    return { ok: true };
  });

  app.post('/auth/password-reset/confirm', strict, async (req) => {
    const input = parse(z.object({ token: z.string().min(20).max(100), password: PasswordSchema }), req.body);
    const done = await ctx.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('password_resets')
        .set({ used_at: new Date() })
        .where('token_hash', '=', hashToken(input.token))
        .where('used_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`)
        .returning('user_id')
        .executeTakeFirst();
      if (!row) return false;
      await trx.updateTable('users').set({ password_hash: await hashPassword(input.password), updated_at: new Date() }).where('id', '=', row.user_id).execute();
      await trx.deleteFrom('sessions').where('user_id', '=', row.user_id).execute();
      return true;
    });
    if (!done) throw badRequest('invalid_token', 'El enlace no es válido o ha caducado.');
    return { ok: true };
  });
}
