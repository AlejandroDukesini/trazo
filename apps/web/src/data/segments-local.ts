import { elevationGainLoss, encodePolyline, getSport, isSuspiciousEffort, matchSegment, sliceGeometry, uuidv7, type SegmentGeometry } from '@trazo/core';
import { userDb, type StoredSegment } from './db';

export interface LocalEffort {
  activityId: string;
  activityName: string;
  startedAt: string;
  elapsedS: number;
  distanceM: number;
  avgHr: number | null;
  flagged: boolean;
  isPersonalBest: boolean;
}

export function segmentGeometry(seg: StoredSegment): SegmentGeometry {
  return { lat: seg.points.map((p) => p.lat), lng: seg.points.map((p) => p.lng), distanceM: seg.distanceM };
}

/** Crea un segmento personal a partir de un tramo de una actividad. */
export async function createSegmentFromActivity(activityId: string, startIndex: number, endIndex: number, name: string): Promise<string> {
  const db = userDb();
  const [activity, stored] = await Promise.all([db.activities.get(activityId), db.streams.get(activityId)]);
  if (!stored) throw new Error('Esta actividad no tiene recorrido GPS.');
  const g = sliceGeometry(stored.stream, startIndex, endIndex);
  const sport = activity?.sport ?? 'run';
  const elevRaw = g.ele.length ? elevationGainLoss(g.ele, 2) : null;
  const elev = elevRaw && elevRaw.gain != null ? { gain: elevRaw.gain } : null;
  const seg: StoredSegment = {
    id: uuidv7(),
    name: name.trim(),
    sport,
    group: getSport(sport).group,
    distanceM: g.distanceM,
    elevGainM: elev ? Math.round(elev.gain) : null,
    avgGrade: elev && g.distanceM > 0 ? Math.round((elev.gain / g.distanceM) * 1000) / 10 : null,
    polyline: encodePolyline(g.lat.map((la, i) => [la, g.lng[i]!] as [number, number])),
    points: g.lat.map((la, i) => ({ lat: la, lng: g.lng[i]! })),
    createdAt: new Date().toISOString(),
  };
  await db.segments.put(seg);
  return seg.id;
}

export async function deleteSegment(id: string) {
  await userDb().segments.delete(id);
}

/** Todos los intentos de un segmento en el historial local (tu "tabla de clasificación" personal). */
export async function computeEfforts(seg: StoredSegment): Promise<LocalEffort[]> {
  const db = userDb();
  const acts = await db.activities.where('sport').equals(seg.sport).toArray();
  const geom = segmentGeometry(seg);
  const efforts: LocalEffort[] = [];
  for (const a of acts) {
    if (!a.hasStream) continue;
    const s = await db.streams.get(a.id);
    if (!s) continue;
    for (const m of matchSegment(s.stream, geom)) {
      efforts.push({
        activityId: a.id,
        activityName: a.name,
        startedAt: a.startedAt,
        elapsedS: m.elapsedS,
        distanceM: m.distanceM,
        avgHr: m.avgHr,
        flagged: isSuspiciousEffort(seg.sport, m.distanceM, m.elapsedS),
        isPersonalBest: false,
      });
    }
  }
  efforts.sort((x, y) => x.elapsedS - y.elapsedS);
  const best = efforts.find((e) => !e.flagged);
  if (best) best.isPersonalBest = true;
  return efforts;
}

/** Segmentos que coincide esta actividad (para el detalle de actividad). */
export async function effortsForActivity(activityId: string): Promise<Array<{ segmentId: string; name: string; elapsedS: number; distanceM: number; flagged: boolean }>> {
  const db = userDb();
  const [a, s] = await Promise.all([db.activities.get(activityId), db.streams.get(activityId)]);
  if (!a || !s) return [];
  const segs = await db.segments.toArray();
  const out: Array<{ segmentId: string; name: string; elapsedS: number; distanceM: number; flagged: boolean }> = [];
  for (const seg of segs) {
    if (seg.sport !== a.sport) continue;
    for (const m of matchSegment(s.stream, segmentGeometry(seg))) {
      out.push({ segmentId: seg.id, name: seg.name, elapsedS: m.elapsedS, distanceM: m.distanceM, flagged: isSuspiciousEffort(a.sport, m.distanceM, m.elapsedS) });
    }
  }
  return out.sort((x, y) => x.elapsedS - y.elapsedS);
}
