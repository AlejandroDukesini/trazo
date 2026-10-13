import {
  GpsFilter, LiveMetrics, createSession, getSport, haversine, pointsToStream, timerMs, toRecPoint, transition, uuidv7,
  type RawFix, type RecEvent, type RecPoint, type Visibility,
} from '@trazo/core';
import { geo, type GeoError } from '../platform/geo';
import { platform } from '../platform';
import { saveNewActivity } from './activities';
import { userDb, type StoredRecSession } from './db';
import type { LocalActivity, Me } from './types';

export type GpsStatus = 'off' | 'searching' | 'ok' | 'weak' | 'denied' | 'error';

export interface RecorderState {
  session: StoredRecSession | null;
  sport: string;
  gps: { status: GpsStatus; accuracy: number | null; lastFixAt: number | null; position: { lat: number; lng: number } | null; message: string | null };
  distanceM: number;
  movingMs: number;
  elevGainM: number;
  splits: Array<{ index: number; timeMs: number }>;
  track: { lat: number[]; lng: number[] };
  pointCount: number;
  /** Aviso cuando el sistema detuvo la ubicación (p. ej. web en segundo plano). */
  gapWarning: string | null;
}

const ACTIVE: StoredRecSession['status'][] = ['recording', 'paused', 'finishing', 'error'];
const FLUSH_MS = 2000;

const initial = (sport = 'run'): RecorderState => ({
  session: null,
  sport,
  gps: { status: 'off', accuracy: null, lastFixAt: null, position: null, message: null },
  distanceM: 0, movingMs: 0, elevGainM: 0, splits: [], track: { lat: [], lng: [] }, pointCount: 0, gapWarning: null,
});

/**
 * Grabador de actividades. Independiente de React; la UI se suscribe con useSyncExternalStore.
 * - Cada transición de la máquina de estados se persiste inmediatamente.
 * - Los puntos aceptados se escriben en IndexedDB cada ≤ 2 s (clave [sesión+tiempo]: sin duplicados).
 * - Tras un cierre inesperado, `recover()` reconstruye todo desde lo persistido.
 */
export class Recorder {
  private state: RecorderState = initial();
  private listeners = new Set<() => void>();
  private filter: GpsFilter | null = null;
  private metrics: LiveMetrics | null = null;
  private buffer: RecPoint[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private gpsOn = false;
  private lastDisplayed: { lat: number; lng: number } | null = null;
  private opQueue: Promise<unknown> = Promise.resolve();
  private accepted = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.state;

  private set(p: Partial<RecorderState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  /** Serializa operaciones para que un doble toque no ejecute dos transiciones a la vez. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opQueue.then(fn, fn);
    this.opQueue = next.catch(() => undefined);
    return next;
  }

  get isActive() {
    return !!this.state.session && ACTIVE.includes(this.state.session.status);
  }

  setSport(sport: string) {
    if (this.state.session && this.state.session.status !== 'ready') return;
    this.set({ sport });
  }

  /** Enciende el GPS para adquirir señal antes de empezar. */
  async warmUp() {
    if (this.gpsOn) return;
    const perm = await geo.permission();
    if (perm === 'denied') {
      this.set({ gps: { ...this.state.gps, status: 'denied', message: 'Permite el acceso a la ubicación para grabar.' } });
      return;
    }
    if (perm !== 'granted') {
      const r = await geo.request();
      if (r === 'denied') {
        this.set({ gps: { ...this.state.gps, status: 'denied', message: 'Permite el acceso a la ubicación para grabar.' } });
        return;
      }
    }
    const id = this.state.session?.id ?? uuidv7();
    if (!this.state.session) this.set({ session: createSession(id, this.state.sport, Date.now()) });
    this.gpsOn = true;
    this.set({ gps: { ...this.state.gps, status: 'searching', message: null } });
    await geo.start(id, this.onFixes, this.onGeoError);
  }

  async coolDown() {
    if (this.isActive || !this.gpsOn) return;
    this.gpsOn = false;
    await geo.stop();
    this.set({ gps: { ...this.state.gps, status: 'off' } });
  }

  private onGeoError = (e: GeoError) => {
    if (e.code === 'timeout') {
      this.set({ gps: { ...this.state.gps, status: this.state.gps.status === 'ok' ? 'weak' : 'searching', message: e.message } });
      return;
    }
    this.set({ gps: { ...this.state.gps, status: e.code === 'denied' ? 'denied' : 'error', message: e.message } });
  };

  private onFixes = (fixes: RawFix[]) => {
    const s = this.state.session;
    let { lat, lng } = this.state.track;
    let changed = false;
    let last: RawFix | null = null;
    for (const fix of fixes) {
      last = fix;
      if (!s || s.status !== 'recording' || !this.filter || !this.metrics || s.startedAt == null || fix.time < s.startedAt) continue;
      const r = this.filter.push(fix);
      if (!r.accepted) continue;
      if (r.newSegment) {
        s.seg += 1;
        void this.persistSession();
      }
      const p = toRecPoint(s.id, fix, s.seg);
      this.buffer.push(p);
      this.accepted++;
      this.metrics.add(p);
      if (!this.lastDisplayed || haversine(this.lastDisplayed.lat, this.lastDisplayed.lng, p.lat, p.lng) >= 4) {
        if (!changed) { lat = lat.slice(); lng = lng.slice(); changed = true; }
        lat.push(p.lat); lng.push(p.lng);
        this.lastDisplayed = { lat: p.lat, lng: p.lng };
      }
    }
    if (!last) return;
    const acc = last.accuracy ?? null;
    const status: GpsStatus = acc != null && acc > 35 ? 'weak' : 'ok';
    const prevFix = this.state.gps.lastFixAt;
    const gap = prevFix && s?.status === 'recording' ? last.time - prevFix : 0;
    const m = this.metrics;
    this.set({
      gps: { status, accuracy: acc, lastFixAt: last.time, position: { lat: last.lat, lng: last.lng }, message: null },
      ...(m && { distanceM: m.distanceM, movingMs: m.movingMs, elevGainM: m.elevGainM, splits: m.splits.slice() }),
      ...(changed && { track: { lat, lng } }),
      pointCount: this.accepted,
      ...(gap > 30_000 && platform === 'web' && {
        gapWarning: `El navegador detuvo la ubicación durante ${Math.round(gap / 1000)} s (pantalla apagada o app en segundo plano). Ese tramo se ha unido en línea recta.`,
      }),
    });
  };

  currentSpeed(now: number) {
    return this.metrics?.currentSpeed(now) ?? null;
  }

  private async persistSession() {
    const s = this.state.session;
    if (!s || s.status === 'ready') return;
    await userDb().recSessions.put({ ...s, platform });
  }

  private async flush() {
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await userDb().recPoints.bulkPut(batch);
      const s = this.state.session;
      if (s && geo.ack) await geo.ack(s.id, batch[batch.length - 1]!.time).catch(() => undefined);
    } catch (err) {
      // Si falla la escritura (cuota, etc.) se reintenta en el siguiente ciclo sin perder puntos.
      this.buffer = batch.concat(this.buffer);
      console.error('No se pudieron guardar puntos', err);
    }
  }

  private startFlushing() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
  }

  private stopFlushing() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private apply(e: RecEvent): boolean {
    const s = this.state.session;
    if (!s) return false;
    const next = transition(s, e);
    if (next === s) return false;
    this.set({ session: next as StoredRecSession });
    return true;
  }

  start() {
    return this.serial(async () => {
      if (!this.state.session) await this.warmUp();
      const s = this.state.session;
      if (!s || s.status !== 'ready') return;
      this.set({ session: { ...s, sport: this.state.sport } });
      if (!this.apply({ type: 'START', at: Date.now() })) return;
      this.filter = new GpsFilter(this.state.sport);
      this.metrics = new LiveMetrics(this.state.sport);
      this.lastDisplayed = null;
      this.accepted = 0;
      this.set({ distanceM: 0, movingMs: 0, elevGainM: 0, splits: [], track: { lat: [], lng: [] }, pointCount: 0, gapWarning: null });
      await this.persistSession();
      this.startFlushing();
      navigator.vibrate?.(40);
    });
  }

  pause() {
    return this.serial(async () => {
      if (!this.apply({ type: 'PAUSE', at: Date.now() })) return;
      await this.flush();
      await this.persistSession();
      navigator.vibrate?.([30, 60, 30]);
    });
  }

  resume() {
    return this.serial(async () => {
      if (!this.apply({ type: 'RESUME', at: Date.now() })) return;
      // El primer punto tras la pausa abre tramo: no se suma distancia por el desplazamiento en pausa.
      this.filter?.reset();
      await this.persistSession();
      navigator.vibrate?.(40);
    });
  }

  lap() {
    return this.serial(async () => {
      if (this.apply({ type: 'LAP', at: Date.now() })) await this.persistSession();
    });
  }

  /** Detiene la grabación; la actividad queda pendiente de guardar (estado `finishing`). */
  finish() {
    return this.serial(async () => {
      if (!this.apply({ type: 'FINISH', at: Date.now() })) return;
      await this.persistSession();
      this.stopFlushing();
      // Últimos puntos nativos antes de parar el servicio.
      await this.flush();
      await geo.stop();
      this.gpsOn = false;
      await this.flush();
      this.set({ gps: { ...this.state.gps, status: 'off' } });
    });
  }

  saveDraft(draft: StoredRecSession['draft']) {
    const s = this.state.session;
    if (!s) return;
    this.set({ session: { ...s, draft } });
    void this.persistSession();
  }

  /** Construye la actividad y la guarda en local + cola de sincronización. Funciona sin conexión. */
  save(form: { name: string; description: string; visibility: Visibility; rpe: number | null }, me: Me) {
    return this.serial(async (): Promise<LocalActivity | null> => {
      const s = this.state.session;
      if (!s || (s.status !== 'finishing' && s.status !== 'error')) return null;
      if (s.status === 'error') this.apply({ type: 'RETRY', at: Date.now() });
      try {
        const points = await userDb().recPoints.where('sessionId').equals(s.id).toArray();
        const startedAt = s.startedAt!;
        const finishedAt = s.finishedAt ?? Date.now();
        const stream = points.length >= 2 ? pointsToStream(points, startedAt) : null;
        const activity = await saveNewActivity({
          id: s.id,
          sport: s.sport,
          name: form.name,
          description: form.description,
          visibility: form.visibility,
          startedAt: new Date(startedAt).toISOString(),
          source: stream ? 'recorded' : 'manual',
          elapsedS: Math.max(1, Math.round((finishedAt - startedAt) / 1000)),
          stream,
          lapMarks: s.lapMarks,
          pauses: s.pauses.map(([a, b]) => [a - startedAt, (b ?? finishedAt) - startedAt] as [number, number]),
          rpe: form.rpe,
          device: platform === 'android' ? 'Trazo Android' : platform === 'windows' ? 'Trazo Windows' : 'Trazo Web',
          manual: stream ? undefined : { movingS: Math.round(timerMs(s, finishedAt) / 1000) },
        }, me);
        this.apply({ type: 'SAVED', at: Date.now() });
        await this.cleanup(s.id);
        return activity;
      } catch (err) {
        this.apply({ type: 'FAILED', at: Date.now(), error: (err as Error).message });
        await this.persistSession();
        throw err;
      }
    });
  }

  discard() {
    return this.serial(async () => {
      const s = this.state.session;
      this.stopFlushing();
      this.buffer = [];
      if (this.gpsOn) await geo.stop();
      this.gpsOn = false;
      if (s) await this.cleanup(s.id);
    });
  }

  private async cleanup(sessionId: string) {
    const db = userDb();
    await db.transaction('rw', db.recSessions, db.recPoints, async () => {
      await db.recSessions.delete(sessionId);
      await db.recPoints.where('sessionId').equals(sessionId).delete();
    });
    this.filter = null;
    this.metrics = null;
    this.state = initial(this.state.sport);
    this.listeners.forEach((l) => l());
  }

  /** Recupera una sesión interrumpida (cierre de la app, recarga, reinicio del proceso). */
  async recover(): Promise<StoredRecSession | null> {
    const db = userDb();
    const sessions = await db.recSessions.toArray();
    const s = sessions.filter((x) => ACTIVE.includes(x.status)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!s) return null;
    const points = (await db.recPoints.where('sessionId').equals(s.id).toArray()).sort((a, b) => a.time - b.time);
    this.metrics = LiveMetrics.fromPoints(s.sport, points);
    this.filter = new GpsFilter(s.sport);
    const last = points[points.length - 1];
    if (last) this.filter.reset({ lat: last.lat, lng: last.lng, time: last.time, accuracy: last.accuracy, alt: last.alt });
    const lat: number[] = [], lng: number[] = [];
    for (const p of points) {
      const prev = lat.length ? { lat: lat[lat.length - 1]!, lng: lng[lng.length - 1]! } : null;
      if (!prev || haversine(prev.lat, prev.lng, p.lat, p.lng) >= 4) { lat.push(p.lat); lng.push(p.lng); }
    }
    this.accepted = points.length;
    this.lastDisplayed = lat.length ? { lat: lat[lat.length - 1]!, lng: lng[lng.length - 1]! } : null;
    this.set({
      session: s, sport: s.sport,
      distanceM: this.metrics.distanceM, movingMs: this.metrics.movingMs, elevGainM: this.metrics.elevGainM,
      splits: this.metrics.splits.slice(), track: { lat, lng }, pointCount: points.length,
    });
    if (s.status === 'recording' || s.status === 'paused') {
      // Reengancha el GPS. En Android, el servicio nativo puede seguir activo y entrega lo acumulado.
      this.gpsOn = true;
      this.set({ gps: { ...this.state.gps, status: 'searching' } });
      await geo.start(s.id, this.onFixes, this.onGeoError);
      this.startFlushing();
    }
    return s;
  }

  timer(now: number) {
    return this.state.session ? timerMs(this.state.session, now) : 0;
  }
}

export const recorder = new Recorder();

export function defaultActivityName(sport: string, date = new Date()): string {
  const h = date.getHours();
  const part = h < 6 ? 'nocturna' : h < 12 ? 'matinal' : h < 15 ? 'de mediodía' : h < 21 ? 'de tarde' : 'nocturna';
  const label = getSport(sport).label;
  // Concordancia sencilla de género para los nombres más comunes.
  const fem = ['Carrera', 'Caminata', 'Natación'].includes(label);
  const adj = fem ? part : part.replace('nocturna', 'nocturno');
  return `${label} ${adj}`;
}
