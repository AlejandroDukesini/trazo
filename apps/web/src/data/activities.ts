import { deriveActivity, type Stream, type Visibility } from '@trazo/core';
import { userDb, type OutboxOp } from './db';
import { sync } from './sync';
import type { ActivityDTO, LocalActivity, Me } from './types';

export interface NewActivityInput {
  id: string;
  sport: string;
  name: string;
  description: string;
  visibility: Visibility;
  startedAt: string;
  source: 'recorded' | 'imported' | 'manual';
  elapsedS: number;
  stream: Stream | null;
  lapMarks?: number[];
  pauses?: Array<[number, number]>;
  rpe?: number | null;
  device?: string;
  manual?: { distanceM?: number; movingS?: number; elevGainM?: number };
}

/**
 * Guarda una actividad nueva en local y encola su envío, en UNA transacción:
 * o queda todo registrado o nada. Funciona sin conexión.
 */
export async function saveNewActivity(input: NewActivityInput, me: Me): Promise<LocalActivity> {
  const db = userDb();
  const d = deriveActivity(input.stream, input.sport, input.lapMarks ?? [], input.rpe, { weightKg: me.weightKg, hrMax: me.hrMax }, { elapsedS: input.elapsedS, ...input.manual });
  const st = d.stats;
  const activity: LocalActivity = {
    id: input.id,
    owner: { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl },
    sport: input.sport,
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    source: input.source,
    startedAt: input.startedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    elapsedS: input.elapsedS,
    timerS: d.timerS,
    movingS: d.movingS,
    distanceM: d.distanceM,
    elevGainM: d.elevGainM,
    elevLossM: st?.elevLossM ?? null,
    avgSpeed: d.avgSpeed,
    maxSpeed: st?.maxSpeed ?? 0,
    avgHr: st?.avgHr ?? null,
    maxHr: st?.maxHr ?? null,
    avgPower: st?.avgPower ?? null,
    maxPower: st?.maxPower ?? null,
    avgCadence: st?.avgCadence ?? null,
    calories: d.calories,
    caloriesEstimated: d.calories != null,
    rpe: input.rpe ?? null,
    trainingLoad: d.trainingLoad,
    polyline: st?.polyline ?? null,
    hasStream: !!input.stream && input.stream.t.length >= 2,
    stats: st ? { splits: st.splits, splitsImperial: st.splitsImperial, laps: st.laps, bestEfforts: st.bestEfforts, pointCount: st.pointCount } : {},
    lapMarks: input.lapMarks ?? [],
    version: 0,
    changeSeq: 0,
    updatedAt: new Date().toISOString(),
    deleted: false,
    reactionCount: 0,
    commentCount: 0,
    viewerReacted: false,
    photos: [],
    syncState: 'pending',
    pauses: input.pauses ?? [],
    device: input.device,
  };
  const now = Date.now();
  await db.transaction('rw', db.activities, db.streams, db.outbox, async () => {
    await db.activities.put(activity);
    if (input.stream && activity.hasStream) await db.streams.put({ activityId: input.id, stream: input.stream });
    // Si ya hay una creación encolada (reintento local), no se duplica.
    const existing = await db.outbox.where({ entityId: input.id, kind: 'activity.create' }).first();
    if (!existing) await db.outbox.add({ kind: 'activity.create', entityId: input.id, attempts: 0, nextAttemptAt: now, createdAt: now });
  });
  void sync.run();
  return activity;
}

export type EditableFields = Partial<Pick<ActivityDTO, 'name' | 'description' | 'visibility' | 'sport' | 'rpe'>>;

/** Edita en local y encola el cambio (las ediciones pendientes se fusionan). */
export async function editActivity(id: string, patch: EditableFields) {
  const db = userDb();
  await db.transaction('rw', db.activities, db.outbox, async () => {
    const a = await db.activities.get(id);
    if (!a) throw new Error('Actividad no encontrada');
    await db.activities.update(id, { ...patch, syncState: 'pending', updatedAt: new Date().toISOString() });
    // Si aún no se ha creado en el servidor, la creación enviará los datos actuales.
    const create = await db.outbox.where({ entityId: id, kind: 'activity.create' }).first();
    if (create) return;
    const pending = await db.outbox.where({ entityId: id, kind: 'activity.update' }).first();
    if (pending) {
      await db.outbox.update(pending.seq!, { patch: { ...pending.patch, ...patch }, nextAttemptAt: Date.now(), attempts: 0 });
    } else {
      const op: OutboxOp = { kind: 'activity.update', entityId: id, patch, baseVersion: a.version, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() };
      await db.outbox.add(op);
    }
  });
  void sync.run();
}

export async function deleteActivityLocal(id: string) {
  const db = userDb();
  await db.transaction('rw', db.activities, db.streams, db.outbox, async () => {
    const create = await db.outbox.where({ entityId: id, kind: 'activity.create' }).first();
    await db.outbox.where('entityId').equals(id).delete();
    await db.activities.delete(id);
    await db.streams.delete(id);
    // Si nunca llegó al servidor, basta con borrarla en local.
    if (!create) await db.outbox.add({ kind: 'activity.delete', entityId: id, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() });
  });
  void sync.run();
}

/** Resolución explícita de un conflicto de edición. */
export async function resolveConflict(id: string, keep: 'mine' | 'server') {
  const db = userDb();
  const a = await db.activities.get(id);
  if (!a?.serverCopy) return;
  const server = a.serverCopy;
  if (keep === 'server') {
    await db.activities.put({ ...server, syncState: 'synced' });
    return;
  }
  const patch: EditableFields = { name: a.name, description: a.description, visibility: a.visibility, sport: a.sport, rpe: a.rpe };
  await db.transaction('rw', db.activities, db.outbox, async () => {
    await db.activities.update(id, { syncState: 'pending', version: server.version, serverCopy: undefined });
    await db.outbox.where({ entityId: id, kind: 'activity.update' }).delete();
    await db.outbox.add({ kind: 'activity.update', entityId: id, patch, baseVersion: server.version, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() });
  });
  void sync.run();
}
