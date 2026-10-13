import { RouteSchema, cumulativeDistance, elevationGainLoss, routeToGpx } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { DB } from '../db/types.js';
import { badRequest, forbidden, idParam, notFound, parse, sendFile } from '../http.js';
import { canViewActivity, relation } from '../services/social.js';
import type { Selectable } from 'kysely';

type RouteRow = Selectable<DB['routes']>;

function routeDto(r: RouteRow, full: boolean) {
  return {
    id: r.id, ownerId: r.owner_id, name: r.name, sport: r.sport, description: r.description, visibility: r.visibility,
    distanceM: r.distance_m, elevGainM: r.elev_gain_m, routed: r.routed, favorite: r.favorite, version: r.version,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    waypoints: r.waypoints,
    ...(full ? { geometry: { lat: r.lat, lng: r.lng, ele: r.ele } } : { preview: { lat: r.lat.filter((_, i) => i % Math.ceil(r.lat.length / 200) === 0), lng: r.lng.filter((_, i) => i % Math.ceil(r.lng.length / 200) === 0) } }),
  };
}

export async function plannedRouteRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  async function loadRoute(id: string, viewerId: string) {
    const r = await db.selectFrom('routes').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!r) throw notFound('Ruta');
    if (r.owner_id === viewerId) return r;
    const owner = await db.selectFrom('users').select('is_private').where('id', '=', r.owner_id).executeTakeFirstOrThrow();
    if (!canViewActivity(await relation(db, viewerId, r.owner_id), owner.is_private, r.visibility)) throw notFound('Ruta');
    return r;
  }

  app.get('/routes', async (req) => {
    const viewer = requireUser(req);
    const { favorite } = parse(z.object({ favorite: z.coerce.boolean().optional() }), req.query);
    let q = db.selectFrom('routes').selectAll().where('owner_id', '=', viewer.id).where('deleted_at', 'is', null);
    if (favorite) q = q.where('favorite', '=', true);
    const rows = await q.orderBy('favorite', 'desc').orderBy('updated_at', 'desc').limit(200).execute();
    return rows.map((r) => routeDto(r, false));
  });

  /** Crear o reemplazar (idempotente por id de cliente; control de versión opcional). */
  app.put('/routes/:id', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const viewer = requireUser(req);
    const id = idParam(req);
    const body = parse(RouteSchema.extend({ baseVersion: z.number().int().optional() }), req.body);
    if (body.id !== id) throw badRequest('id_mismatch', 'El id no coincide.');
    const g = body.geometry;
    if (g.lat.length !== g.lng.length || g.lat.length < 2) throw badRequest('invalid_geometry', 'Geometría no válida.');
    if (g.ele && g.ele.length !== g.lat.length) throw badRequest('invalid_geometry', 'Elevación no válida.');
    const dist = cumulativeDistance({ lat: g.lat, lng: g.lng });
    const values = {
      name: body.name, sport: body.sport, description: body.description, visibility: body.visibility,
      waypoints: JSON.stringify(body.waypoints), lat: g.lat, lng: g.lng, ele: g.ele ?? null,
      distance_m: dist[dist.length - 1] ?? 0, elev_gain_m: elevationGainLoss(g.ele, 2).gain,
      routed: body.routed, favorite: body.favorite, updated_at: new Date(),
    };
    const existing = await db.selectFrom('routes').select(['owner_id', 'version', 'deleted_at']).where('id', '=', id).executeTakeFirst();
    if (existing) {
      if (existing.owner_id !== viewer.id) throw forbidden();
      if (body.baseVersion != null && body.baseVersion !== existing.version) throw badRequest('version_conflict', 'La ruta cambió en otro dispositivo.');
      const r = await db.updateTable('routes').set({ ...values, version: sql`version + 1`, deleted_at: null }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      return routeDto(r, true);
    }
    const r = await db.insertInto('routes').values({ id, owner_id: viewer.id, ...values }).returningAll().executeTakeFirstOrThrow();
    return routeDto(r, true);
  });

  app.get('/routes/:id', async (req) => routeDto(await loadRoute(idParam(req), requireUser(req).id), true));

  app.patch('/routes/:id/favorite', async (req) => {
    const viewer = requireUser(req);
    const { favorite } = parse(z.object({ favorite: z.boolean() }), req.body);
    await db.updateTable('routes').set({ favorite }).where('id', '=', idParam(req)).where('owner_id', '=', viewer.id).execute();
    return { ok: true };
  });

  app.delete('/routes/:id', async (req) => {
    const viewer = requireUser(req);
    await db.updateTable('routes').set({ deleted_at: new Date() }).where('id', '=', idParam(req)).where('owner_id', '=', viewer.id).execute();
    return { ok: true };
  });

  app.get('/routes/:id/export', async (req, reply) => {
    const r = await loadRoute(idParam(req), requireUser(req).id);
    return sendFile(reply, `${r.name}.gpx`, 'application/gpx+xml', routeToGpx(r.name, r.lat, r.lng, r.ele ?? undefined));
  });
}
