import {
  ActivityCreateSchema, applyPrivacyZones, deriveActivity, expandBBox, getSport, isSuspiciousEffort, matchSegment, publicPolyline,
  type ActivityPatch, type ManualValues, type PrivacyZone, type Stream,
} from '@trazo/core';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { AppContext } from '../context.js';
import type { Activity, DB } from '../db/types.js';
import { conflict, notFound, parse } from '../http.js';
import { canViewActivity, relation, userCard, type UserCard } from './social.js';

export async function privacyZonesOf(db: Kysely<DB>, userId: string): Promise<PrivacyZone[]> {
  const rows = await db.selectFrom('privacy_zones').select(['lat', 'lng', 'radius_m']).where('user_id', '=', userId).execute();
  return rows.map((r) => ({ lat: r.lat, lng: r.lng, radiusM: r.radius_m }));
}

/** Carga una actividad no borrada y verifica que el espectador puede verla (404 si no). */
export async function loadVisibleActivity(db: Kysely<DB>, id: string, viewerId: string | null): Promise<Activity> {
  const a = await db.selectFrom('activities').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!a) throw notFound('Actividad');
  if (a.owner_id === viewerId) return a;
  const owner = await db.selectFrom('users').select('is_private').where('id', '=', a.owner_id).executeTakeFirstOrThrow();
  if (!canViewActivity(await relation(db, viewerId, a.owner_id), owner.is_private, a.visibility)) throw notFound('Actividad');
  return a;
}

export async function loadStream(db: Kysely<DB> | Transaction<DB>, activityId: string): Promise<Stream | null> {
  const r = await db.selectFrom('activity_streams').selectAll().where('activity_id', '=', activityId).executeTakeFirst();
  if (!r) return null;
  const s: Stream = { t: r.t, lat: r.lat, lng: r.lng };
  if (r.seg) s.seg = r.seg;
  if (r.ele) s.ele = r.ele;
  if (r.hr) s.hr = r.hr;
  if (r.power) s.power = r.power;
  if (r.cadence) s.cadence = r.cadence;
  return s;
}

interface UserPhysio {
  weight_kg: number | null;
  hr_max: number | null;
}

/** Calcula todos los campos derivados a partir del recorrido (lógica común en @trazo/core). El servidor nunca confía en métricas del cliente. */
export function derive(stream: Stream | null, sport: string, lapMarks: number[], rpe: number | null | undefined, user: UserPhysio, zones: PrivacyZone[], manual: ManualValues) {
  const d = deriveActivity(stream, sport, lapMarks, rpe, { weightKg: user.weight_kg, hrMax: user.hr_max }, manual);
  const base = {
    timer_s: d.timerS,
    moving_s: d.movingS,
    distance_m: d.distanceM,
    elev_gain_m: d.elevGainM,
    avg_speed: d.avgSpeed,
    calories: d.calories,
    training_load: d.trainingLoad,
  };
  const st = d.stats;
  if (!st || !stream) return { ...base, stats: JSON.stringify({}) };
  const pub = publicPolyline(stream, zones);
  return {
    ...base,
    elev_loss_m: st.elevLossM,
    ele_min: st.eleMin,
    ele_max: st.eleMax,
    max_speed: st.maxSpeed,
    avg_hr: st.avgHr,
    max_hr: st.maxHr,
    avg_power: st.avgPower,
    max_power: st.maxPower,
    avg_cadence: st.avgCadence,
    polyline: st.polyline,
    public_polyline: pub.polyline,
    min_lat: st.bbox?.minLat ?? null,
    min_lng: st.bbox?.minLng ?? null,
    max_lat: st.bbox?.maxLat ?? null,
    max_lng: st.bbox?.maxLng ?? null,
    start_lat: st.start?.[0] ?? null,
    start_lng: st.start?.[1] ?? null,
    stats: JSON.stringify({ splits: st.splits, splitsImperial: st.splitsImperial, laps: st.laps, bestEfforts: st.bestEfforts, pointCount: st.pointCount }),
  };
}

export type CreateResult = { activity: Activity; created: boolean };

/**
 * Crea una actividad de forma idempotente: el id lo genera el cliente. Si ya existe y es del
 * mismo usuario (reintento tras respuesta perdida) se devuelve la existente sin duplicar.
 */
export async function createActivity(ctx: AppContext, ownerId: string, body: unknown): Promise<CreateResult> {
  const input = parse(ActivityCreateSchema, body);
  const existing = await ctx.db.selectFrom('activities').selectAll().where('id', '=', input.id).executeTakeFirst();
  if (existing) {
    if (existing.owner_id !== ownerId) throw conflict('id_conflict', 'Identificador ya utilizado.');
    return { activity: existing, created: false };
  }
  const user = await ctx.db.selectFrom('users').select(['weight_kg', 'hr_max']).where('id', '=', ownerId).executeTakeFirstOrThrow();
  const zones = await privacyZonesOf(ctx.db, ownerId);
  const stream = input.stream && input.stream.t.length >= 2 ? input.stream : null;
  if (stream) {
    // Normaliza: t relativo al primer punto (ya validado como ordenado).
    const t0 = stream.t[0]!;
    if (t0 !== 0) stream.t = stream.t.map((t) => t - t0);
  }
  const d = derive(stream, input.sport, input.lapMarks, input.rpe, user, zones, {
    distanceM: input.distanceM, movingS: input.movingS, elevGainM: input.elevGainM, elapsedS: input.elapsedS,
  });
  const inserted = await ctx.db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('activities')
      .values({
        id: input.id,
        owner_id: ownerId,
        sport: input.sport,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        source: input.source,
        started_at: input.startedAt,
        timezone: input.timezone ?? null,
        elapsed_s: input.elapsedS,
        rpe: input.rpe ?? null,
        device: input.device ?? null,
        lap_marks: input.lapMarks,
        pauses: JSON.stringify(input.pauses),
        ...d,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (row && stream) {
      await trx
        .insertInto('activity_streams')
        .values({
          activity_id: row.id,
          t: stream.t,
          lat: stream.lat,
          lng: stream.lng,
          ele: stream.ele ?? null,
          hr: stream.hr ?? null,
          power: stream.power ?? null,
          cadence: stream.cadence ?? null,
          seg: stream.seg ?? null,
        })
        .execute();
    }
    return row;
  });
  if (!inserted) {
    // Carrera entre dos peticiones simultáneas con el mismo id.
    const again = await ctx.db.selectFrom('activities').selectAll().where('id', '=', input.id).executeTakeFirstOrThrow();
    if (again.owner_id !== ownerId) throw conflict('id_conflict', 'Identificador ya utilizado.');
    return { activity: again, created: false };
  }
  if (stream) await matchActivitySegments(ctx, inserted, stream);
  return { activity: inserted, created: true };
}

export async function patchActivity(ctx: AppContext, activity: Activity, patch: ActivityPatch): Promise<Activity> {
  if (patch.baseVersion !== activity.version) {
    throw conflict('version_conflict', 'La actividad cambió en otro dispositivo.', { server: activity.version });
  }
  const sportChanged = patch.sport && patch.sport !== activity.sport;
  const rpeChanged = patch.rpe !== undefined && patch.rpe !== activity.rpe;
  let derived: Partial<ReturnType<typeof derive>> = {};
  let stream: Stream | null = null;
  if (sportChanged || rpeChanged) {
    const user = await ctx.db.selectFrom('users').select(['weight_kg', 'hr_max']).where('id', '=', activity.owner_id).executeTakeFirstOrThrow();
    stream = await loadStream(ctx.db, activity.id);
    derived = derive(stream, patch.sport ?? activity.sport, activity.lap_marks, patch.rpe === undefined ? activity.rpe : patch.rpe, user,
      await privacyZonesOf(ctx.db, activity.owner_id),
      { distanceM: activity.distance_m, movingS: activity.moving_s, elevGainM: activity.elev_gain_m ?? undefined, elapsedS: activity.elapsed_s });
  }
  const updated = await ctx.db
    .updateTable('activities')
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.visibility !== undefined && { visibility: patch.visibility }),
      ...(patch.sport !== undefined && { sport: patch.sport }),
      ...(patch.rpe !== undefined && { rpe: patch.rpe }),
      ...derived,
      version: sql`version + 1`,
      change_seq: sql`nextval('activity_change_seq')`,
      updated_at: new Date(),
    })
    .where('id', '=', activity.id)
    .where('version', '=', patch.baseVersion)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw conflict('version_conflict', 'La actividad cambió en otro dispositivo.');
  if (sportChanged && stream) {
    await ctx.db.deleteFrom('segment_efforts').where('activity_id', '=', activity.id).execute();
    await matchActivitySegments(ctx, updated, stream);
  }
  return updated;
}

/** Borrado lógico con tombstone (para que otros dispositivos lo sincronicen); libera datos pesados. */
export async function deleteActivity(ctx: AppContext, activity: Activity) {
  if (activity.deleted_at) return;
  const photos = await ctx.db.selectFrom('activity_photos').select('path').where('activity_id', '=', activity.id).execute();
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('activity_streams').where('activity_id', '=', activity.id).execute();
    await trx.deleteFrom('segment_efforts').where('activity_id', '=', activity.id).execute();
    await trx.deleteFrom('activity_photos').where('activity_id', '=', activity.id).execute();
    await trx.deleteFrom('notifications').where('entity_id', '=', activity.id).execute();
    await trx
      .updateTable('activities')
      .set({
        deleted_at: new Date(), polyline: null, public_polyline: null, stats: JSON.stringify({}),
        version: sql`version + 1`, change_seq: sql`nextval('activity_change_seq')`, updated_at: new Date(),
      })
      .where('id', '=', activity.id)
      .execute();
  });
  await Promise.all(photos.map((p) => ctx.storage.remove(p.path).catch(() => undefined)));
}

/** Busca segmentos cuya caja envolvente se cruza con la actividad y registra intentos. */
export async function matchActivitySegments(ctx: AppContext, activity: Activity, stream: Stream) {
  if (activity.min_lat == null || activity.source === 'manual') return 0;
  const sport = getSport(activity.sport);
  if (sport.group === 'other') return 0;
  const box = expandBBox({ minLat: activity.min_lat, minLng: activity.min_lng!, maxLat: activity.max_lat!, maxLng: activity.max_lng! }, 50);
  const segments = await ctx.db
    .selectFrom('segments')
    .select(['id', 'lat', 'lng', 'distance_m'])
    .where('deleted_at', 'is', null)
    .where('sport_group', '=', sport.group)
    .where('min_lat', '<=', box.maxLat)
    .where('max_lat', '>=', box.minLat)
    .where('min_lng', '<=', box.maxLng)
    .where('max_lng', '>=', box.minLng)
    .limit(500)
    .execute();
  let count = 0;
  for (const seg of segments) {
    const matches = matchSegment(stream, { lat: seg.lat, lng: seg.lng, distanceM: seg.distance_m });
    for (const m of matches) {
      await ctx.db
        .insertInto('segment_efforts')
        .values({
          segment_id: seg.id,
          activity_id: activity.id,
          user_id: activity.owner_id,
          started_at: new Date(new Date(activity.started_at).getTime() + stream.t[m.startIndex]!),
          elapsed_s: m.elapsedS,
          distance_m: m.distanceM,
          avg_hr: m.avgHr,
          start_index: m.startIndex,
          end_index: m.endIndex,
          flagged: isSuspiciousEffort(activity.sport, m.distanceM, m.elapsedS),
        })
        .onConflict((oc) => oc.columns(['segment_id', 'activity_id', 'start_index']).doNothing())
        .execute();
      count++;
    }
  }
  return count;
}

/** Recalcula las polilíneas públicas tras cambiar las zonas privadas. */
export async function recomputePublicPolylines(ctx: AppContext, userId: string) {
  const zones = await privacyZonesOf(ctx.db, userId);
  const ids = await ctx.db.selectFrom('activities').select('id').where('owner_id', '=', userId).where('deleted_at', 'is', null).where('polyline', 'is not', null).execute();
  for (const { id } of ids) {
    const stream = await loadStream(ctx.db, id);
    if (!stream) continue;
    await ctx.db.updateTable('activities').set({ public_polyline: publicPolyline(stream, zones).polyline }).where('id', '=', id).execute();
  }
}

export function streamForViewer(stream: Stream, isOwner: boolean, zones: PrivacyZone[]): Stream {
  return isOwner ? stream : applyPrivacyZones(stream, zones);
}

export interface ActivityExtras {
  owner: UserCard;
  reactionCount?: number;
  commentCount?: number;
  viewerReacted?: boolean;
  photos?: Array<{ id: string; url: string }>;
}

/** DTO único. Datos de ubicación exactos (bbox, inicio, polilínea completa) solo para el propietario. */
export function activityDto(a: Activity, viewerId: string | null, extras: ActivityExtras) {
  const isOwner = viewerId === a.owner_id;
  return {
    id: a.id,
    owner: extras.owner,
    sport: a.sport,
    name: a.name,
    description: a.description,
    visibility: a.visibility,
    source: a.source,
    startedAt: new Date(a.started_at).toISOString(),
    timezone: a.timezone,
    elapsedS: a.elapsed_s,
    timerS: a.timer_s,
    movingS: a.moving_s,
    distanceM: a.distance_m,
    elevGainM: a.elev_gain_m,
    elevLossM: a.elev_loss_m,
    avgSpeed: a.avg_speed,
    maxSpeed: a.max_speed,
    avgHr: a.avg_hr,
    maxHr: a.max_hr,
    avgPower: a.avg_power,
    maxPower: a.max_power,
    avgCadence: a.avg_cadence,
    calories: a.calories,
    caloriesEstimated: a.calories != null,
    rpe: isOwner ? a.rpe : null,
    trainingLoad: isOwner ? a.training_load : null,
    polyline: isOwner ? a.polyline : a.public_polyline,
    hasStream: a.polyline != null,
    stats: a.stats,
    lapMarks: a.lap_marks,
    version: a.version,
    changeSeq: a.change_seq,
    updatedAt: a.updated_at.toISOString(),
    deleted: a.deleted_at != null,
    reactionCount: extras.reactionCount ?? 0,
    commentCount: extras.commentCount ?? 0,
    viewerReacted: extras.viewerReacted ?? false,
    photos: extras.photos ?? [],
  };
}

/** Carga propietarios, contadores y fotos para una lista de actividades en 4 consultas. */
export async function hydrate(db: Kysely<DB>, rows: Activity[], viewerId: string | null) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const [owners, reactions, comments, mine, photos] = await Promise.all([
    db.selectFrom('users').select(['id', 'username', 'display_name', 'avatar_path', 'updated_at']).where('id', 'in', ownerIds).execute(),
    db.selectFrom('reactions').select(['activity_id', db.fn.countAll<number>().as('n')]).where('activity_id', 'in', ids).groupBy('activity_id').execute(),
    db.selectFrom('comments').select(['activity_id', db.fn.countAll<number>().as('n')]).where('activity_id', 'in', ids).where('deleted_at', 'is', null).groupBy('activity_id').execute(),
    viewerId
      ? db.selectFrom('reactions').select('activity_id').where('activity_id', 'in', ids).where('user_id', '=', viewerId).execute()
      : Promise.resolve([] as Array<{ activity_id: string }>),
    db.selectFrom('activity_photos').select(['id', 'activity_id']).where('activity_id', 'in', ids).orderBy('created_at').execute(),
  ]);
  const ownerMap = new Map(owners.map((o) => [o.id, userCard(o)]));
  const rMap = new Map(reactions.map((r) => [r.activity_id, Number(r.n)]));
  const cMap = new Map(comments.map((r) => [r.activity_id, Number(r.n)]));
  const mineSet = new Set(mine.map((m) => m.activity_id));
  return rows.map((a) =>
    activityDto(a, viewerId, {
      owner: ownerMap.get(a.owner_id)!,
      reactionCount: rMap.get(a.id) ?? 0,
      commentCount: cMap.get(a.id) ?? 0,
      viewerReacted: mineSet.has(a.id),
      photos: photos.filter((p) => p.activity_id === a.id).map((p) => ({ id: p.id, url: `/api/media/photos/${p.id}` })),
    }),
  );
}
