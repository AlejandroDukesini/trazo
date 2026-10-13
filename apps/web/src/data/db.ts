import Dexie, { type Table } from 'dexie';
import type { RecPoint, RecSession, Stream } from '@trazo/core';
import type { LocalActivity, Me } from './types';

export interface StoredStream {
  activityId: string;
  stream: Stream;
}

export interface StoredRecSession extends RecSession {
  /** Nombre/visibilidad elegidos en la pantalla de guardado (si se interrumpió allí). */
  draft?: { name?: string; description?: string; visibility?: string; rpe?: number | null };
  platform?: string;
}

/** Objetivo de entrenamiento (antes en el backend, ahora local). */
export interface StoredGoal {
  id: string;
  period: 'week' | 'month' | 'year';
  metric: 'distance' | 'duration' | 'elevation' | 'count';
  target: number;
  sport: string | null;
  createdAt: string;
}

/** Ruta guardada (antes en el backend, ahora local). */
export interface StoredRoute {
  id: string;
  name: string;
  sport: string;
  favorite: boolean;
  distanceM: number;
  elevGainM: number | null;
  waypoints: Array<{ lat: number; lng: number }>;
  geometry: { lat: number[]; lng: number[]; ele: Array<number | null> | null };
  createdAt: string;
  updatedAt: string;
}

/** Segmento personal definido a partir de un recorrido (antes en el backend, ahora local). */
export interface StoredSegment {
  id: string;
  name: string;
  sport: string;
  group: string;
  distanceM: number;
  elevGainM: number | null;
  avgGrade: number | null;
  polyline: string;
  points: Array<{ lat: number; lng: number }>;
  createdAt: string;
}

/**
 * Base de datos local de un único usuario. No hay cuenta ni sincronización:
 * todo vive en este dispositivo.
 */
export class UserDB extends Dexie {
  activities!: Table<LocalActivity, string>;
  streams!: Table<StoredStream, string>;
  recSessions!: Table<StoredRecSession, string>;
  recPoints!: Table<RecPoint, [string, number]>;
  goals!: Table<StoredGoal, string>;
  routes!: Table<StoredRoute, string>;
  segments!: Table<StoredSegment, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor(userId: string) {
    super(`trazo-user-${userId}`);
    this.version(1).stores({
      activities: 'id, startedAt, sport, syncState',
      streams: 'activityId',
      outbox: '++seq, entityId, kind, [entityId+kind]',
      recSessions: 'id, status',
      recPoints: '[sessionId+time], sessionId',
      kv: 'key',
    });
    // v2: app totalmente local — se añaden objetivos, rutas y segmentos locales.
    this.version(2).stores({
      goals: 'id, period',
      routes: 'id, favorite, updatedAt',
      segments: 'id, sport',
      outbox: null, // se elimina la cola de sincronización
    });
  }
}

/** Base global: solo el perfil local y preferencias del dispositivo. */
class MetaDB extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('trazo-meta');
    this.version(1).stores({ kv: 'key' });
  }
}

export const metaDb = new MetaDB();

export async function metaGet<T>(key: string): Promise<T | undefined> {
  return (await metaDb.kv.get(key))?.value as T | undefined;
}
export async function metaSet(key: string, value: unknown) {
  await metaDb.kv.put({ key, value });
}
export async function metaDel(key: string) {
  await metaDb.kv.delete(key);
}

export const LOCAL_USER_ID = 'local';

export const getProfile = () => metaGet<Me>('profile');
export const setProfile = (me: Me) => metaSet('profile', me);

let current: UserDB | null = null;

export function openUserDb(userId: string = LOCAL_USER_ID): UserDB {
  if (current && current.name === `trazo-user-${userId}`) return current;
  current?.close();
  current = new UserDB(userId);
  return current;
}

export function userDb(): UserDB {
  if (!current) throw new Error('Base de datos local no inicializada');
  return current;
}

export function hasUserDb() {
  return current != null;
}

export async function deleteUserDb(userId: string = LOCAL_USER_ID) {
  if (current?.name === `trazo-user-${userId}`) {
    current.close();
    current = null;
  }
  await Dexie.delete(`trazo-user-${userId}`);
}

/** Pide al navegador almacenamiento persistente (evita que se borre por presión de espacio). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* no disponible */
  }
}
