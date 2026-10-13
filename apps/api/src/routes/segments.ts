import { SPORTS, SegmentCreateSchema, elevationGainLoss, expandBBox, getSport, haversine, isSuspiciousEffort, matchSegment, sliceGeometry } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { badRequest, forbidden, idParam, notFound, parse } from '../http.js';
import { loadStream, privacyZonesOf } from '../services/activities.js';
import { getEntitlements } from '../services/entitlements.js';
import { userCard } from '../services/social.js';

const MIN_SEGMENT_M = 200;
const MAX_SEGMENT_M = 50_000;

export async function segmentRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  app.post('/segments', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const viewer = requireUser(req);
    const input = parse(SegmentCreateSchema, req.body);
    const act = await db.selectFrom('activities').selectAll().where('id', '=', input.activityId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!act) throw notFound('Actividad');
    if (act.owner_id !== viewer.id) throw forbidden('Solo puedes crear segmentos desde tus actividades.');
    const group = getSport(act.sport).group;
    if (group === 'other') throw badRequest('unsupported_sport', 'Este deporte no admite segmentos.');
    const stream = await loadStream(db, act.id);
    if (!stream) throw badRequest('no_stream', 'La actividad no tiene recorrido.');
    if (input.endIndex >= stream.t.length || input.startIndex >= input.endIndex) throw badRequest('invalid_range', 'Rango no válido.');
    const geom = sliceGeometry(stream, input.startIndex, input.endIndex);
    if (geom.distanceM < MIN_SEGMENT_M || geom.distanceM > MAX_SEGMENT_M) throw badRequest('invalid_length', `Un segmento debe medir entre ${MIN_SEGMENT_M} m y ${MAX_SEGMENT_M / 1000} km.`);
    // Un segmento es público: no puede tocar zonas privadas de quien lo crea.
    const zones = await privacyZonesOf(db, viewer.id);
    if (geom.lat.some((la, i) => zones.some((z0) => haversine(la, geom.lng[i]!, z0.lat, z0.lng) <= z0.radiusM))) {
      throw badRequest('privacy_zone', 'El segmento atraviesa una de tus zonas privadas.');
    }
    const elev = elevationGainLoss(geom.ele);
    const seg = await db
      .insertInto('segments')
      .values({
        name: input.name, sport_group: group, creator_id: viewer.id, source_activity_id: act.id,
        lat: geom.lat, lng: geom.lng, ele: geom.ele.length ? geom.ele : null,
        distance_m: geom.distanceM, elev_gain_m: elev.gain,
        min_lat: geom.bbox.minLat, min_lng: geom.bbox.minLng, max_lat: geom.bbox.maxLat, max_lng: geom.bbox.maxLng,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    // Busca intentos en actividades existentes de la zona (acotado a las 1000 más recientes).
    const box = expandBBox(geom.bbox, 50);
    const candidates = await db
      .selectFrom('activities')
      .select(['id', 'owner_id', 'sport', 'started_at'])
      .where('deleted_at', 'is', null)
      .where('source', '<>', 'manual')
      .where('sport', 'in', Object.values(SPORTS).filter((s) => s.group === group).map((s) => s.key))
      .where('min_lat', '<=', box.maxLat).where('max_lat', '>=', box.minLat)
      .where('min_lng', '<=', box.maxLng).where('max_lng', '>=', box.minLng)
      .orderBy('started_at', 'desc')
      .limit(1000)
      .execute();
    let efforts = 0;
    for (const c of candidates) {
      const s = await loadStream(db, c.id);
      if (!s) continue;
      for (const m of matchSegment(s, { lat: seg.lat, lng: seg.lng, distanceM: seg.distance_m })) {
        await db
          .insertInto('segment_efforts')
          .values({
            segment_id: seg.id, activity_id: c.id, user_id: c.owner_id,
            started_at: new Date(new Date(c.started_at).getTime() + s.t[m.startIndex]!),
            elapsed_s: m.elapsedS, distance_m: m.distanceM, avg_hr: m.avgHr, start_index: m.startIndex, end_index: m.endIndex,
            flagged: isSuspiciousEffort(c.sport, m.distanceM, m.elapsedS),
          })
          .onConflict((oc) => oc.columns(['segment_id', 'activity_id', 'start_index']).doNothing())
          .execute();
        efforts++;
      }
    }
    reply.code(201);
    return { id: seg.id, efforts };
  });

  app.get('/segments', async (req) => {
    requireUser(req);
    const q = parse(z.object({ minLat: z.coerce.number(), minLng: z.coerce.number(), maxLat: z.coerce.number(), maxLng: z.coerce.number(), group: z.enum(['foot', 'ride']).optional() }), req.query);
    let query = db
      .selectFrom('segments')
      .select(['id', 'name', 'sport_group', 'distance_m', 'elev_gain_m', 'lat', 'lng'])
      .where('deleted_at', 'is', null)
      .where('min_lat', '<=', q.maxLat).where('max_lat', '>=', q.minLat)
      .where('min_lng', '<=', q.maxLng).where('max_lng', '>=', q.minLng);
    if (q.group) query = query.where('sport_group', '=', q.group);
    const rows = await query.limit(50).execute();
    return rows.map((r) => ({ id: r.id, name: r.name, group: r.sport_group, distanceM: r.distance_m, elevGainM: r.elev_gain_m, lat: r.lat, lng: r.lng }));
  });

  app.get('/segments/:id', async (req) => {
    requireUser(req);
    const s = await db
      .selectFrom('segments as s')
      .leftJoin('users as u', 'u.id', 's.creator_id')
      .select(['s.id', 's.name', 's.sport_group', 's.distance_m', 's.elev_gain_m', 's.lat', 's.lng', 's.ele', 's.created_at', 'u.username as creator'])
      .where('s.id', '=', idParam(req))
      .where('s.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!s) throw notFound('Segmento');
    const elev = s.ele?.filter((e): e is number => e != null) ?? [];
    const grade = elev.length > 1 && s.distance_m > 0 ? ((elev[elev.length - 1]! - elev[0]!) / s.distance_m) * 100 : null;
    return {
      id: s.id, name: s.name, group: s.sport_group, distanceM: s.distance_m, elevGainM: s.elev_gain_m,
      avgGrade: grade != null ? Math.round(grade * 10) / 10 : null,
      lat: s.lat, lng: s.lng, ele: s.ele, createdAt: s.created_at.toISOString(), creator: s.creator,
    };
  });

  app.delete('/segments/:id', async (req) => {
    const viewer = requireUser(req);
    const s = await db.selectFrom('segments').select(['creator_id']).where('id', '=', idParam(req)).executeTakeFirst();
    if (!s) return { ok: true };
    if (s.creator_id !== viewer.id && viewer.role === 'user') throw forbidden();
    await db.updateTable('segments').set({ deleted_at: new Date() }).where('id', '=', idParam(req)).execute();
    return { ok: true };
  });

  /**
   * Clasificación: mejor intento por persona, solo intentos válidos (no marcados) de actividades
   * que el espectador puede ver. Gratis: top N + posición propia. Plus: hasta 100.
   */
  app.get('/segments/:id/leaderboard', async (req) => {
    const viewer = requireUser(req);
    const segId = idParam(req);
    const q = parse(z.object({ period: z.enum(['all', 'year', 'month', 'week']).default('all'), scope: z.enum(['all', 'following']).default('all') }), req.query);
    const ent = await getEntitlements(ctx, viewer.id);
    const since = q.period === 'all' ? null : sql`date_trunc(${q.period}, now())`;
    const rows = await sql<{ user_id: string; elapsed_s: number; activity_id: string; started_at: Date; avg_hr: number | null; username: string; display_name: string; avatar_path: string | null; updated_at: Date }>`
      select * from (
        select distinct on (e.user_id) e.user_id, e.elapsed_s, e.activity_id, e.started_at, e.avg_hr,
               u.username, u.display_name, u.avatar_path, u.updated_at
        from segment_efforts e
        join activities a on a.id = e.activity_id and a.deleted_at is null
        join users u on u.id = e.user_id and u.suspended_at is null
        where e.segment_id = ${segId}
          and not e.flagged
          ${since ? sql`and e.started_at >= ${since}` : sql``}
          and (
            e.user_id = ${viewer.id}
            or (a.visibility = 'public' and not u.is_private ${q.scope === 'following' ? sql`and false` : sql``})
            or (a.visibility in ('public','followers') and exists (
              select 1 from follows f where f.follower_id = ${viewer.id} and f.followee_id = e.user_id and f.status = 'accepted'))
          )
          and not exists (select 1 from blocks b where (b.blocker_id = ${viewer.id} and b.blocked_id = e.user_id) or (b.blocker_id = e.user_id and b.blocked_id = ${viewer.id}))
        order by e.user_id, e.elapsed_s asc
      ) best
      order by elapsed_s asc, started_at asc
    `.execute(db);
    const all = rows.rows.map((r, i) => ({
      rank: i + 1, user: userCard({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_path: r.avatar_path, updated_at: r.updated_at }),
      elapsedS: r.elapsed_s, activityId: r.activity_id, date: new Date(r.started_at).toISOString(), avgHr: r.avg_hr,
    }));
    const limit = ent.limits.leaderboardRows;
    const mine = all.find((r) => r.user.id === viewer.id) ?? null;
    return { total: all.length, entries: all.slice(0, limit), me: mine, limited: all.length > limit, limit };
  });

  app.get('/segments/:id/efforts/me', async (req) => {
    const viewer = requireUser(req);
    const rows = await db
      .selectFrom('segment_efforts as e')
      .innerJoin('activities as a', 'a.id', 'e.activity_id')
      .select(['e.id', 'e.elapsed_s', 'e.started_at', 'e.avg_hr', 'e.activity_id', 'e.flagged', 'a.name'])
      .where('e.segment_id', '=', idParam(req))
      .where('e.user_id', '=', viewer.id)
      .where('a.deleted_at', 'is', null)
      .orderBy('e.started_at', 'desc')
      .limit(500)
      .execute();
    return rows.map((r) => ({ id: r.id, elapsedS: r.elapsed_s, date: new Date(r.started_at).toISOString(), avgHr: r.avg_hr, activityId: r.activity_id, activityName: r.name, flagged: r.flagged }));
  });
}
