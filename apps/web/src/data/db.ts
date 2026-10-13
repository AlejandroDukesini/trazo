import Dexie, { type Table } from 'dexie';
import type { RecPoint, RecSession, Stream } from '@trazo/core';
import type { LocalActivity, SessionData } from './types';

export type OutboxKind = 'activity.create' | 'activity.update' | 'activity.delete';

export interface OutboxOp {
  seq?: number;
  kind: OutboxKind;
  entityId: string;
  /** Para updates: campos modificados (se fusionan si hay varios pendientes). */
  patch?: Record<string, unknown>;
  baseVersion?: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
}

export interface StoredStream {
  activityId: string;
  stream: Stream;
}

export interface StoredRecSession extends RecSession {
  /** Nombre/visibilidad elegidos en la pantalla de guardado (si se interrumpió allí). */
  draft?: { name?: string; description?: string; visibility?: string; rpe?: number | null };
  platform?: string;
}

/** Base de datos por usuario: separar cuentas evita mezclar datos al cambiar de sesión. */
export class UserDB extends Dexie {
  activities!: Table<LocalActivity, string>;
  streams!: Table<StoredStream, string>;
  outbox!: Table<OutboxOp, number>;
  recSessions!: Table<StoredRecSession, string>;
  recPoints!: Table<RecPoint, [string, number]>;
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
  }
}

/** Base global: sesión en caché (arranque sin conexión) y token de los clientes nativos. */
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

export const getCachedSession = () => metaGet<SessionData>('session');

let current: UserDB | null = null;

export function openUserDb(userId: string): UserDB {
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

export async function deleteUserDb(userId: string) {
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
