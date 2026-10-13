import { deriveActivity, type Stream, type Visibility } from '@trazo/core';
import { userDb } from './db';
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
  /** Fotos adjuntas (p. ej. el pantallazo importado), como data URLs. */
  photos?: Array<{ id: string; url: string }>;
}

/** Guarda una actividad nueva en la base local. Todo ocurre en este dispositivo. */
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
    updatedAt: new Date().toISOString(),
    photos: input.photos ?? [],
    pauses: input.pauses ?? [],
    device: input.device,
  };
  await db.transaction('rw', db.activities, db.streams, async () => {
    await db.activities.put(activity);
    if (input.stream && activity.hasStream) await db.streams.put({ activityId: input.id, stream: input.stream });
  });
  return activity;
}

export type EditableFields = Partial<Pick<ActivityDTO, 'name' | 'description' | 'visibility' | 'sport' | 'rpe'>>;

/** Edita una actividad en local. */
export async function editActivity(id: string, patch: EditableFields) {
  const db = userDb();
  const a = await db.activities.get(id);
  if (!a) throw new Error('Actividad no encontrada');
  await db.activities.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function deleteActivityLocal(id: string) {
  const db = userDb();
  await db.transaction('rw', db.activities, db.streams, async () => {
    await db.activities.delete(id);
    await db.streams.delete(id);
  });
}
