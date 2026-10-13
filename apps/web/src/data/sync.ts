import { ApiError, api } from './api';
import { hasUserDb, userDb, type OutboxOp } from './db';
import type { ActivityDTO, LocalActivity } from './types';

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  /** Operaciones que el servidor rechazó y requieren atención. */
  failed: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

const MAX_BACKOFF_MS = 5 * 60_000;
const PERMANENT_RETRY_MS = 24 * 3600_000;

export function backoff(attempts: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** attempts);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/**
 * Motor de sincronización local-first.
 * - push: procesa la cola persistente (outbox) en orden; idempotente gracias a ids de cliente.
 * - pull: descarga cambios propios desde el último cursor (incluye borrados).
 * Solo una pestaña sincroniza a la vez (Web Locks). Nunca sobrescribe ediciones locales pendientes.
 */
export class SyncEngine {
  private status: SyncStatus = { state: 'idle', pending: 0, failed: 0, lastSyncAt: null, lastError: null };
  private listeners = new Set<() => void>();
  private current: Promise<void> | null = null;
  private again = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onOnline = () => void this.run();
  private onVisible = () => { if (document.visibilityState === 'visible') void this.run(); };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.status;

  private set(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((l) => l());
  }

  start() {
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.interval = setInterval(() => void this.run(), 60_000);
    void this.run();
  }

  stop() {
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.interval) clearInterval(this.interval);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.interval = this.retryTimer = null;
  }

  /** Lanza una sincronización. Si ya hay una en curso, devuelve esa misma (y repite al terminar). */
  run(): Promise<void> {
    if (!hasUserDb()) return Promise.resolve();
    if (this.current) {
      this.again = true;
      return this.current;
    }
    this.current = this.loop().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  /** Espera a que termine la sincronización en curso (si la hay). */
  idle(): Promise<void> {
    return this.current ?? Promise.resolve();
  }

  private async loop() {
    do {
      this.again = false;
      const locks = (navigator as Navigator & { locks?: LockManager }).locks;
      if (locks) await locks.request(`trazo-sync:${userDb().name}`, { ifAvailable: true }, async (lock) => { if (lock) await this.cycle(); });
      else await this.cycle();
    } while (this.again);
  }

  private async refreshCounts() {
    const db = userDb();
    const [pending, failed] = await Promise.all([db.outbox.count(), db.activities.where('syncState').equals('error').count()]);
    this.set({ pending, failed });
  }

  private async cycle() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.set({ state: 'offline' });
      await this.refreshCounts();
      return;
    }
    this.set({ state: 'syncing' });
    try {
      await this.push();
      await this.pull();
      this.set({ state: 'idle', lastSyncAt: Date.now(), lastError: null });
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) this.set({ state: 'offline' });
      else if (err instanceof ApiError && err.status === 401) this.set({ state: 'idle' });
      else this.set({ state: 'error', lastError: (err as Error).message });
    } finally {
      await this.refreshCounts();
      await this.scheduleRetry();
    }
  }

  private async scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const next = await userDb().outbox.orderBy('seq').toArray();
    const soonest = Math.min(...next.map((o) => o.nextAttemptAt).filter((t) => t < Date.now() + PERMANENT_RETRY_MS / 2));
    if (Number.isFinite(soonest)) this.retryTimer = setTimeout(() => void this.run(), Math.max(1000, soonest - Date.now()));
  }

  private async push() {
    const db = userDb();
    const ops = await db.outbox.orderBy('seq').toArray();
    for (const op of ops) {
      if (op.nextAttemptAt > Date.now()) continue;
      try {
        await this.process(op);
      } catch (err) {
        if (err instanceof ApiError && (err.isNetwork || err.status === 401)) throw err; // se reintenta todo más tarde
        const transient = !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
        const attempts = op.attempts + 1;
        await db.outbox.update(op.seq!, {
          attempts,
          lastError: (err as Error).message,
          nextAttemptAt: Date.now() + (transient ? backoff(attempts) : PERMANENT_RETRY_MS),
        });
        if (!transient) await db.activities.update(op.entityId, { syncState: 'error', lastError: (err as Error).message });
      }
    }
  }

  private async process(op: OutboxOp) {
    const db = userDb();
    if (op.kind === 'activity.delete') {
      await api(`/activities/${op.entityId}`, { method: 'DELETE' });
      await db.outbox.delete(op.seq!);
      return;
    }
    const local = await db.activities.get(op.entityId);
    if (!local) {
      await db.outbox.delete(op.seq!);
      return;
    }
    const before = local.updatedAt;
    if (op.kind === 'activity.create') {
      const stored = await db.streams.get(op.entityId);
      const body: Record<string, unknown> = {
        id: local.id, sport: local.sport, name: local.name, description: local.description, visibility: local.visibility,
        startedAt: local.startedAt, timezone: local.timezone ?? undefined, source: local.source, elapsedS: local.elapsedS,
        rpe: local.rpe, lapMarks: local.lapMarks, pauses: local.pauses ?? [], device: local.device,
      };
      if (stored) body.stream = stored.stream;
      if (local.source === 'manual') Object.assign(body, { distanceM: local.distanceM, movingS: local.movingS, elevGainM: local.elevGainM ?? undefined });
      const dto = await api<ActivityDTO>(`/activities/${local.id}`, { method: 'PUT', body });
      await this.applyServer(op, dto, before);
      return;
    }
    // update
    try {
      const dto = await api<ActivityDTO>(`/activities/${op.entityId}`, { method: 'PATCH', body: { baseVersion: op.baseVersion, ...op.patch } });
      await this.applyServer(op, dto, before);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        const server = (err.details as { server?: ActivityDTO } | undefined)?.server;
        await db.transaction('rw', db.activities, db.outbox, async () => {
          await db.activities.update(op.entityId, { syncState: 'conflict', serverCopy: server });
          await db.outbox.delete(op.seq!);
        });
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        await db.transaction('rw', db.activities, db.streams, db.outbox, async () => {
          await db.activities.delete(op.entityId);
          await db.streams.delete(op.entityId);
          await db.outbox.where('entityId').equals(op.entityId).delete();
        });
        return;
      }
      throw err;
    }
  }

  /** Aplica la respuesta del servidor sin pisar ediciones hechas mientras la petición estaba en curso. */
  private async applyServer(op: OutboxOp, dto: ActivityDTO, localUpdatedAtBefore: string) {
    const db = userDb();
    await db.transaction('rw', db.activities, db.outbox, async () => {
      await db.outbox.delete(op.seq!);
      const now = await db.activities.get(dto.id);
      if (!now) return;
      if (now.updatedAt !== localUpdatedAtBefore) {
        // Hubo ediciones locales durante el envío: se conservan y se encolan sobre la nueva versión.
        const patch = { name: now.name, description: now.description, visibility: now.visibility, sport: now.sport, rpe: now.rpe };
        await db.activities.update(dto.id, { version: dto.version, changeSeq: dto.changeSeq, syncState: 'pending' });
        const pendingUpdate = await db.outbox.where({ entityId: dto.id, kind: 'activity.update' }).first();
        if (pendingUpdate) await db.outbox.update(pendingUpdate.seq!, { baseVersion: dto.version, patch: { ...patch, ...pendingUpdate.patch } });
        else await db.outbox.add({ kind: 'activity.update', entityId: dto.id, patch, baseVersion: dto.version, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() });
        return;
      }
      const pendingOps = await db.outbox.where('entityId').equals(dto.id).count();
      const next: LocalActivity = { ...dto, syncState: pendingOps ? 'pending' : 'synced' };
      await db.activities.put(next);
    });
  }

  private async pull() {
    const db = userDb();
    let cursor = ((await db.kv.get('syncCursor'))?.value as number | undefined) ?? 0;
    for (let guard = 0; guard < 1000; guard++) {
      const res = await api<{ items: ActivityDTO[]; cursor: number; more: boolean }>(`/sync/activities?since=${cursor}&limit=200`);
      await db.transaction('rw', db.activities, db.streams, db.outbox, db.kv, async () => {
        for (const item of res.items) {
          const pending = await db.outbox.where('entityId').equals(item.id).count();
          if (item.deleted) {
            // El borrado es explícito y gana a ediciones locales pendientes.
            await db.activities.delete(item.id);
            await db.streams.delete(item.id);
            if (pending) await db.outbox.where('entityId').equals(item.id).delete();
            continue;
          }
          if (pending) continue; // la edición local se resolverá al enviarla (control de versión)
          const existing = await db.activities.get(item.id);
          if (existing?.syncState === 'conflict') continue;
          if (existing && existing.version >= item.version && existing.syncState === 'synced') continue;
          await db.activities.put({ ...item, syncState: 'synced' });
        }
        await db.kv.put({ key: 'syncCursor', value: res.cursor });
      });
      cursor = res.cursor;
      if (!res.more) break;
    }
  }
}

export const sync = new SyncEngine();
