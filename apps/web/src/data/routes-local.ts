import { cumulativeDistance, elevationGainLoss } from '@trazo/core';
import { userDb, type StoredRoute } from './db';

export interface RouteInput {
  id: string;
  name: string;
  sport: string;
  favorite: boolean;
  waypoints: Array<{ lat: number; lng: number }>;
  geometry: { lat: number[]; lng: number[]; ele: Array<number | null> | null };
}

export function getRoute(id: string): Promise<StoredRoute | undefined> {
  return userDb().routes.get(id);
}

export async function saveRoute(input: RouteInput): Promise<StoredRoute> {
  const db = userDb();
  const dist = cumulativeDistance({ lat: input.geometry.lat, lng: input.geometry.lng });
  const elev = input.geometry.ele ? elevationGainLoss(input.geometry.ele, 2) : null;
  const existing = await db.routes.get(input.id);
  const now = new Date().toISOString();
  const route: StoredRoute = {
    id: input.id,
    name: input.name.trim() || 'Ruta sin nombre',
    sport: input.sport,
    favorite: input.favorite,
    distanceM: Math.round(dist[dist.length - 1] ?? 0),
    elevGainM: elev && elev.gain != null ? Math.round(elev.gain) : null,
    waypoints: input.waypoints,
    geometry: input.geometry,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.routes.put(route);
  return route;
}

export async function deleteRoute(id: string) {
  await userDb().routes.delete(id);
}
