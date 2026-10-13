import { PrivacyZoneSchema, ProfilePatchSchema } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, requireUser, verifyPassword } from '../auth.js';
import { badRequest, notFound, parse } from '../http.js';
import { loadStream, recomputePublicPolylines } from '../services/activities.js';
import { sniffImage } from '../services/storage.js';
import { meDto } from './auth.js';

const MAX_ZONES = 5;

export async function meRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  app.patch('/me', async (req) => {
    const u = requireUser(req);
    const p = parse(ProfilePatchSchema, req.body);
    const user = await db
      .updateTable('users')
      .set({
        ...(p.displayName !== undefined && { display_name: p.displayName }),
        ...(p.bio !== undefined && { bio: p.bio }),
        ...(p.location !== undefined && { location: p.location }),
        ...(p.isPrivate !== undefined && { is_private: p.isPrivate }),
        ...(p.units !== undefined && { units: p.units }),
        ...(p.defaultVisibility !== undefined && { default_visibility: p.defaultVisibility }),
        ...(p.weightKg !== undefined && { weight_kg: p.weightKg }),
        ...(p.hrMax !== undefined && { hr_max: p.hrMax }),
        ...(p.hrRest !== undefined && { hr_rest: p.hrRest }),
        ...(p.ftp !== undefined && { ftp: p.ftp }),
        updated_at: new Date(),
      })
      .where('id', '=', u.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // Al pasar a cuenta pública, las solicitudes pendientes se aceptan.
    if (p.isPrivate === false) {
      await db.updateTable('follows').set({ status: 'accepted' }).where('followee_id', '=', u.id).where('status', '=', 'pending').execute();
    }
    return meDto(user);
  });

  app.post('/me/avatar', async (req) => {
    const u = requireUser(req);
    const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest('no_file', 'Falta el archivo.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('file_too_large', 'La imagen supera 5 MB.');
    const kind = sniffImage(buf);
    if (!kind) throw badRequest('invalid_image', 'Formato no compatible (JPEG, PNG o WebP).');
    const prev = await db.selectFrom('users').select('avatar_path').where('id', '=', u.id).executeTakeFirstOrThrow();
    const path = `avatars/${u.id}.${kind.ext}`;
    await ctx.storage.put(path, buf);
    if (prev.avatar_path && prev.avatar_path !== path) await ctx.storage.remove(prev.avatar_path);
    const user = await db.updateTable('users').set({ avatar_path: path, updated_at: new Date() }).where('id', '=', u.id).returningAll().executeTakeFirstOrThrow();
    return meDto(user);
  });

  app.delete('/me/avatar', async (req) => {
    const u = requireUser(req);
    const prev = await db.selectFrom('users').select('avatar_path').where('id', '=', u.id).executeTakeFirstOrThrow();
    if (prev.avatar_path) await ctx.storage.remove(prev.avatar_path);
    const user = await db.updateTable('users').set({ avatar_path: null, updated_at: new Date() }).where('id', '=', u.id).returningAll().executeTakeFirstOrThrow();
    return meDto(user);
  });

  app.get('/me/privacy-zones', async (req) => {
    const u = requireUser(req);
    const rows = await db.selectFrom('privacy_zones').selectAll().where('user_id', '=', u.id).orderBy('created_at').execute();
    return rows.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, radiusM: r.radius_m, label: r.label }));
  });

  app.post('/me/privacy-zones', async (req, reply) => {
    const u = requireUser(req);
    const z0 = parse(PrivacyZoneSchema, req.body);
    const n = await db.selectFrom('privacy_zones').select(db.fn.countAll<number>().as('n')).where('user_id', '=', u.id).executeTakeFirstOrThrow();
    if (Number(n.n) >= MAX_ZONES) throw badRequest('too_many_zones', `Máximo ${MAX_ZONES} zonas privadas.`);
    const row = await db.insertInto('privacy_zones').values({ user_id: u.id, lat: z0.lat, lng: z0.lng, radius_m: z0.radiusM, label: z0.label }).returningAll().executeTakeFirstOrThrow();
    await recomputePublicPolylines(ctx, u.id);
    reply.code(201);
    return { id: row.id, lat: row.lat, lng: row.lng, radiusM: row.radius_m, label: row.label };
  });

  app.delete('/me/privacy-zones/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await db.deleteFrom('privacy_zones').where('id', '=', id).where('user_id', '=', u.id).execute();
    await recomputePublicPolylines(ctx, u.id);
    return { ok: true };
  });

  /** Exportación completa de datos personales (RGPD art. 20). */
  app.get('/me/export', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req, reply) => {
    const u = requireUser(req);
    const user = await db.selectFrom('users').selectAll().where('id', '=', u.id).executeTakeFirstOrThrow();
    const activities = await db.selectFrom('activities').selectAll().where('owner_id', '=', u.id).where('deleted_at', 'is', null).orderBy('started_at').execute();
    const withStreams = [];
    for (const a of activities) withStreams.push({ ...a, stream: await loadStream(db, a.id) });
    const [routes, goals, comments, follows, followers, zones, clubs, subs] = await Promise.all([
      db.selectFrom('routes').selectAll().where('owner_id', '=', u.id).where('deleted_at', 'is', null).execute(),
      db.selectFrom('goals').selectAll().where('user_id', '=', u.id).execute(),
      db.selectFrom('comments').selectAll().where('author_id', '=', u.id).where('deleted_at', 'is', null).execute(),
      db.selectFrom('follows').innerJoin('users', 'users.id', 'follows.followee_id').select(['users.username', 'follows.status', 'follows.created_at']).where('follower_id', '=', u.id).execute(),
      db.selectFrom('follows').innerJoin('users', 'users.id', 'follows.follower_id').select(['users.username', 'follows.status', 'follows.created_at']).where('followee_id', '=', u.id).execute(),
      db.selectFrom('privacy_zones').selectAll().where('user_id', '=', u.id).execute(),
      db.selectFrom('club_members').innerJoin('clubs', 'clubs.id', 'club_members.club_id').select(['clubs.name', 'club_members.role', 'club_members.status']).where('user_id', '=', u.id).execute(),
      db.selectFrom('subscriptions').select(['provider', 'plan', 'status', 'current_period_end', 'created_at']).where('user_id', '=', u.id).execute(),
    ]);
    const { password_hash: _ph, ...profile } = user;
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile, activities: withStreams, routes, goals, comments, following: follows, followers, privacyZones: zones, clubs, subscriptions: subs });
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="trazo-${user.username}-datos.json"`)
      .send(body);
  });

  /** Eliminación de la cuenta y de todos sus datos (cascada) tras confirmar contraseña. */
  app.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = requireUser(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const user = await db.selectFrom('users').select(['password_hash', 'avatar_path']).where('id', '=', u.id).executeTakeFirst();
    if (!user) throw notFound('Usuario');
    if (!(await verifyPassword(user.password_hash, password))) throw badRequest('invalid_password', 'La contraseña no es correcta.');
    const photos = await db.selectFrom('activity_photos').select('path').where('owner_id', '=', u.id).execute();
    await db.deleteFrom('users').where('id', '=', u.id).execute();
    await Promise.all([...photos.map((p) => p.path), ...(user.avatar_path ? [user.avatar_path] : [])].map((p) => ctx.storage.remove(p).catch(() => undefined)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
