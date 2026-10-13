import {
  ActivityPatchSchema, chartSeries, getSport, hrZones, streamToGpx, streamToTcx, timeInZones, uuidv7,
} from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Activity } from '../db/types.js';
import { HttpError, PageQuery, badRequest, conflict, decodeCursor, encodeCursor, forbidden, idParam, notFound, parse, sendFile } from '../http.js';
import {
  createActivity, deleteActivity, hydrate, loadStream, loadVisibleActivity, patchActivity, privacyZonesOf, streamForViewer,
} from '../services/activities.js';
import { requireFeature } from '../services/entitlements.js';
import { sniffImage } from '../services/storage.js';
import { relation, userCard, visibleLevels } from '../services/social.js';

const ListQuery = PageQuery.extend({
  user: z.union([z.literal('me'), z.uuid()]).default('me'),
  sport: z.string().max(30).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(80).optional(),
  minDistance: z.coerce.number().min(0).optional(),
  maxDistance: z.coerce.number().min(0).optional(),
  minDuration: z.coerce.number().min(0).optional(),
  maxDuration: z.coerce.number().min(0).optional(),
});

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 10;

export async function activityRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  const loadVisible = (id: string, viewerId: string | null) => loadVisibleActivity(db, id, viewerId);

  async function loadOwned(id: string, userId: string): Promise<Activity> {
    const a = await db.selectFrom('activities').selectAll().where('id', '=', id).executeTakeFirst();
    if (!a || a.deleted_at) throw notFound('Actividad');
    if (a.owner_id !== userId) throw forbidden();
    return a;
  }

  app.get('/activities', async (req) => {
    const viewer = requireUser(req);
    const q = parse(ListQuery, req.query);
    const ownerId = q.user === 'me' ? viewer.id : q.user;
    let levels: Array<'public' | 'followers' | 'private'> = ['public', 'followers', 'private'];
    if (ownerId !== viewer.id) {
      const owner = await db.selectFrom('users').select('is_private').where('id', '=', ownerId).executeTakeFirst();
      if (!owner) throw notFound('Usuario');
      levels = visibleLevels(await relation(db, viewer.id, ownerId), owner.is_private);
      if (!levels.length) return { items: [], nextCursor: null };
    }
    let query = db
      .selectFrom('activities')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .where('deleted_at', 'is', null)
      .where('visibility', 'in', levels);
    if (q.sport) query = query.where('sport', '=', q.sport);
    if (q.from) query = query.where('started_at', '>=', new Date(q.from));
    if (q.to) query = query.where('started_at', '<', new Date(q.to));
    if (q.q) query = query.where('name', 'ilike', `%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    if (q.minDistance != null) query = query.where('distance_m', '>=', q.minDistance);
    if (q.maxDistance != null) query = query.where('distance_m', '<=', q.maxDistance);
    if (q.minDuration != null) query = query.where('moving_s', '>=', q.minDuration);
    if (q.maxDuration != null) query = query.where('moving_s', '<=', q.maxDuration);
    const c = decodeCursor(q.cursor);
    if (c) query = query.where((eb) => eb.or([eb('started_at', '<', new Date(c.date)), eb.and([eb('started_at', '=', new Date(c.date)), eb('id', '<', c.id)])]));
    const rows = await query.orderBy('started_at', 'desc').orderBy('id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await hydrate(db, page, viewer.id),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.started_at, last.id) : null,
    };
  });

  /** Crear (idempotente por id generado en el cliente). */
  app.put('/activities/:id', { bodyLimit: 30 * 1024 * 1024 }, async (req, reply) => {
    const user = requireUser(req);
    const id = idParam(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.id !== id) throw badRequest('id_mismatch', 'El id del cuerpo no coincide con la URL.');
    const { activity, created } = await createActivity(ctx, user.id, body);
    reply.code(created ? 201 : 200);
    return (await hydrate(db, [activity], user.id))[0];
  });

  app.get('/activities/:id', async (req) => {
    const a = await loadVisible(idParam(req), req.user?.id ?? null);
    return (await hydrate(db, [a], req.user?.id ?? null))[0];
  });

  app.get('/activities/:id/stream', async (req, reply) => {
    const viewerId = req.user?.id ?? null;
    const a = await loadVisible(idParam(req), viewerId);
    const stream = await loadStream(db, a.id);
    if (!stream) throw notFound('Recorrido');
    const isOwner = a.owner_id === viewerId;
    reply.header('cache-control', 'private, max-age=60');
    return streamForViewer(stream, isOwner, isOwner ? [] : await privacyZonesOf(db, a.owner_id));
  });

  app.patch('/activities/:id', async (req) => {
    const user = requireUser(req);
    const a = await loadOwned(idParam(req), user.id);
    const patch = parse(ActivityPatchSchema, req.body);
    try {
      const updated = await patchActivity(ctx, a, patch);
      return (await hydrate(db, [updated], user.id))[0];
    } catch (err) {
      if (err instanceof HttpError && err.code === 'version_conflict') {
        const fresh = await db.selectFrom('activities').selectAll().where('id', '=', a.id).executeTakeFirstOrThrow();
        throw conflict('version_conflict', err.message, { server: (await hydrate(db, [fresh], user.id))[0] });
      }
      throw err;
    }
  });

  app.delete('/activities/:id', async (req) => {
    const user = requireUser(req);
    const a = await db.selectFrom('activities').selectAll().where('id', '=', idParam(req)).executeTakeFirst();
    // Idempotente: borrar algo ya borrado o inexistente no es un error.
    if (!a) return { ok: true };
    if (a.owner_id !== user.id) throw forbidden();
    await deleteActivity(ctx, a);
    return { ok: true };
  });

  /** Cambios de las actividades propias desde un cursor (incluye borrados). */
  app.get('/sync/activities', async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({ since: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const rows = await db
      .selectFrom('activities')
      .selectAll()
      .where('owner_id', '=', user.id)
      .where('change_seq', '>', q.since)
      .orderBy('change_seq')
      .limit(q.limit)
      .execute();
    const items = await hydrate(db, rows, user.id);
    return { items, cursor: rows.length ? rows[rows.length - 1]!.change_seq : q.since, more: rows.length === q.limit };
  });

  app.get('/activities/:id/export', async (req, reply) => {
    const user = requireUser(req);
    const a = await loadOwned(idParam(req), user.id);
    const { format } = parse(z.object({ format: z.enum(['gpx', 'tcx']).default('gpx') }), req.query);
    const stream = await loadStream(db, a.id);
    if (!stream) throw badRequest('no_stream', 'Esta actividad no tiene recorrido.');
    const meta = { name: a.name, sport: a.sport, startedAt: new Date(a.started_at).getTime(), description: a.description };
    const date = new Date(a.started_at).toISOString().slice(0, 10);
    return format === 'gpx'
      ? sendFile(reply, `${date} ${a.name}.gpx`, 'application/gpx+xml', streamToGpx(stream, meta))
      : sendFile(reply, `${date} ${a.name}.tcx`, 'application/vnd.garmin.tcx+xml', streamToTcx(stream, meta));
  });

  app.post('/activities/:id/photos', async (req, reply) => {
    const user = requireUser(req);
    const a = await loadOwned(idParam(req), user.id);
    const count = await db.selectFrom('activity_photos').select(db.fn.countAll<number>().as('n')).where('activity_id', '=', a.id).executeTakeFirstOrThrow();
    if (Number(count.n) >= MAX_PHOTOS) throw badRequest('too_many_photos', `Máximo ${MAX_PHOTOS} fotos por actividad.`);
    const file = await req.file({ limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });
    if (!file) throw badRequest('no_file', 'Falta el archivo.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('file_too_large', 'La foto supera 8 MB.');
    const kind = sniffImage(buf);
    if (!kind) throw badRequest('invalid_image', 'Formato no compatible (JPEG, PNG o WebP).');
    const id = uuidv7();
    const path = `photos/${id}.${kind.ext}`;
    await ctx.storage.put(path, buf);
    await db.insertInto('activity_photos').values({ id, activity_id: a.id, owner_id: user.id, path, mime: kind.mime, bytes: buf.length }).execute();
    reply.code(201);
    return { id, url: `/api/media/photos/${id}` };
  });

  app.delete('/activities/:id/photos/:photoId', async (req) => {
    const user = requireUser(req);
    const { photoId } = parse(z.object({ photoId: z.uuid() }), req.params);
    const a = await loadOwned(idParam(req), user.id);
    const p = await db.deleteFrom('activity_photos').where('id', '=', photoId).where('activity_id', '=', a.id).returning('path').executeTakeFirst();
    if (p) await ctx.storage.remove(p.path);
    return { ok: true };
  });

  app.get('/media/photos/:photoId', async (req, reply) => {
    const { photoId } = parse(z.object({ photoId: z.uuid() }), req.params);
    const p = await db.selectFrom('activity_photos').select(['activity_id', 'path', 'mime']).where('id', '=', photoId).executeTakeFirst();
    if (!p) throw notFound('Foto');
    await loadVisible(p.activity_id, req.user?.id ?? null);
    const stream = await ctx.storage.get(p.path);
    if (!stream) throw notFound('Foto');
    return reply.header('content-type', p.mime).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(stream);
  });

  app.get('/media/avatars/:userId', async (req, reply) => {
    const { userId } = parse(z.object({ userId: z.uuid() }), req.params);
    const u = await db.selectFrom('users').select('avatar_path').where('id', '=', userId).executeTakeFirst();
    if (!u?.avatar_path) throw notFound('Avatar');
    const stream = await ctx.storage.get(u.avatar_path);
    if (!stream) throw notFound('Avatar');
    const mime = u.avatar_path.endsWith('.png') ? 'image/png' : u.avatar_path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply.header('content-type', mime).header('cache-control', 'public, max-age=604800, immutable').header('x-content-type-options', 'nosniff').send(stream);
  });

  /** Tiempo en zonas de FC (Plus). */
  app.get('/activities/:id/zones', async (req) => {
    const user = requireUser(req);
    await requireFeature(ctx, user.id, 'training.zones');
    const a = await loadOwned(idParam(req), user.id);
    const u = await db.selectFrom('users').select('hr_max').where('id', '=', user.id).executeTakeFirstOrThrow();
    if (!u.hr_max) throw conflict('hr_max_required', 'Indica tu frecuencia cardíaca máxima en el perfil para calcular zonas.');
    const stream = await loadStream(db, a.id);
    if (!stream?.hr) return { zones: hrZones(u.hr_max), seconds: null };
    const zones = hrZones(u.hr_max);
    return { zones, seconds: timeInZones(stream.t, stream.hr, zones, stream.seg) };
  });

  /** Comparación de dos actividades visibles (Plus). */
  app.get('/activities/compare', async (req) => {
    const user = requireUser(req);
    await requireFeature(ctx, user.id, 'activities.compare');
    const q = parse(z.object({ a: z.uuid(), b: z.uuid() }), req.query);
    const out = [];
    for (const id of [q.a, q.b]) {
      const act = await loadVisible(id, user.id);
      const stream = await loadStream(db, act.id);
      const isOwner = act.owner_id === user.id;
      const s = stream ? streamForViewer(stream, isOwner, isOwner ? [] : await privacyZonesOf(db, act.owner_id)) : null;
      out.push({ activity: (await hydrate(db, [act], user.id))[0], series: s ? chartSeries(s, 800) : null });
    }
    return { items: out };
  });

  app.get('/activities/:id/efforts', async (req) => {
    const a = await loadVisible(idParam(req), req.user?.id ?? null);
    const rows = await db
      .selectFrom('segment_efforts as e')
      .innerJoin('segments as s', 's.id', 'e.segment_id')
      .select(['e.id', 'e.segment_id', 's.name', 'e.elapsed_s', 'e.distance_m', 'e.avg_hr', 'e.start_index', 'e.end_index', 'e.flagged'])
      .where('e.activity_id', '=', a.id)
      .where('s.deleted_at', 'is', null)
      .orderBy('e.start_index')
      .execute();
    // Posición y récord personal en cada segmento.
    const result = [];
    for (const r of rows) {
      const pr = await db
        .selectFrom('segment_efforts')
        .select(db.fn.min('elapsed_s').as('best'))
        .where('segment_id', '=', r.segment_id)
        .where('user_id', '=', a.owner_id)
        .where('flagged', '=', false)
        .executeTakeFirst();
      result.push({
        id: r.id, segmentId: r.segment_id, name: r.name, elapsedS: r.elapsed_s, distanceM: r.distance_m, avgHr: r.avg_hr,
        startIndex: r.start_index, endIndex: r.end_index, flagged: r.flagged,
        isPersonalBest: !r.flagged && pr?.best != null && Number(pr.best) === r.elapsed_s,
      });
    }
    return result;
  });

  /** Récords personales (mejores esfuerzos) a partir de todas las actividades propias. */
  app.get('/me/records', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .selectFrom('activities')
      .select(['id', 'name', 'sport', 'started_at', sql<Array<{ distanceM: number; label: string; elapsedS: number }> | null>`stats->'bestEfforts'`.as('be')])
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .where('source', '<>', 'manual')
      .execute();
    const best = new Map<string, { group: string; distanceM: number; label: string; elapsedS: number; activityId: string; activityName: string; date: string }>();
    for (const r of rows) {
      const group = getSport(r.sport).group;
      for (const e of r.be ?? []) {
        const key = `${group}:${e.distanceM}`;
        const cur = best.get(key);
        if (!cur || e.elapsedS < cur.elapsedS) {
          best.set(key, { group, distanceM: e.distanceM, label: e.label, elapsedS: e.elapsedS, activityId: r.id, activityName: r.name, date: new Date(r.started_at).toISOString() });
        }
      }
    }
    return [...best.values()].sort((a, b) => a.group.localeCompare(b.group) || a.distanceM - b.distanceM);
  });

  app.get('/activities/:id/reactions', async (req) => {
    const a = await loadVisible(idParam(req), req.user?.id ?? null);
    const rows = await db
      .selectFrom('reactions')
      .innerJoin('users', 'users.id', 'reactions.user_id')
      .select(['users.id', 'users.username', 'users.display_name', 'users.avatar_path', 'users.updated_at'])
      .where('reactions.activity_id', '=', a.id)
      .orderBy('reactions.created_at', 'desc')
      .limit(200)
      .execute();
    return rows.map(userCard);
  });
}
