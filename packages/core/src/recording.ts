import { haversine } from './geo.js';
import type { RawFix } from './gps-filter.js';
import type { Stream } from './schemas.js';
import { getSport } from './sports.js';

export type RecStatus = 'ready' | 'recording' | 'paused' | 'finishing' | 'saved' | 'error';

export interface RecSession {
  /** Id de la futura actividad (UUID v7): idempotencia de extremo a extremo. */
  id: string;
  sport: string;
  status: RecStatus;
  /** Epoch ms del inicio. */
  startedAt: number | null;
  finishedAt: number | null;
  /** Intervalos de pausa en epoch ms; el último puede estar abierto. */
  pauses: Array<[number, number | null]>;
  /** Índice de tramo actual; aumenta en cada reanudación. */
  seg: number;
  /** Marcas de vuelta en ms desde el inicio. */
  lapMarks: number[];
  error: string | null;
  updatedAt: number;
}

export type RecEvent =
  | { type: 'START'; at: number }
  | { type: 'PAUSE'; at: number }
  | { type: 'RESUME'; at: number }
  | { type: 'LAP'; at: number }
  | { type: 'FINISH'; at: number }
  | { type: 'SAVED'; at: number }
  | { type: 'FAILED'; at: number; error: string }
  | { type: 'RETRY'; at: number };

export function createSession(id: string, sport: string, now: number): RecSession {
  return { id, sport, status: 'ready', startedAt: null, finishedAt: null, pauses: [], seg: 0, lapMarks: [], error: null, updatedAt: now };
}

/**
 * Transición pura. Si el evento no es válido en el estado actual devuelve **la misma referencia**,
 * lo que permite detectar dobles toques (p. ej. FINISH dos veces) sin efectos secundarios.
 */
export function transition(s: RecSession, e: RecEvent): RecSession {
  switch (e.type) {
    case 'START':
      if (s.status !== 'ready') return s;
      return { ...s, status: 'recording', startedAt: e.at, updatedAt: e.at };
    case 'PAUSE':
      if (s.status !== 'recording') return s;
      return { ...s, status: 'paused', pauses: [...s.pauses, [e.at, null]], updatedAt: e.at };
    case 'RESUME': {
      if (s.status !== 'paused') return s;
      const pauses = s.pauses.slice();
      const last = pauses[pauses.length - 1];
      if (last && last[1] == null) pauses[pauses.length - 1] = [last[0], e.at];
      return { ...s, status: 'recording', pauses, seg: s.seg + 1, updatedAt: e.at };
    }
    case 'LAP':
      if (s.status !== 'recording' || s.startedAt == null) return s;
      return { ...s, lapMarks: [...s.lapMarks, e.at - s.startedAt], updatedAt: e.at };
    case 'FINISH': {
      if (s.status !== 'recording' && s.status !== 'paused') return s;
      const pauses = s.pauses.slice();
      const last = pauses[pauses.length - 1];
      if (last && last[1] == null) pauses[pauses.length - 1] = [last[0], e.at];
      return { ...s, status: 'finishing', finishedAt: e.at, pauses, updatedAt: e.at };
    }
    case 'SAVED':
      if (s.status !== 'finishing') return s;
      return { ...s, status: 'saved', error: null, updatedAt: e.at };
    case 'FAILED':
      if (s.status !== 'finishing') return s;
      return { ...s, status: 'error', error: e.error, updatedAt: e.at };
    case 'RETRY':
      if (s.status !== 'error') return s;
      return { ...s, status: 'finishing', error: null, updatedAt: e.at };
  }
}

export function pausedMs(s: RecSession, now: number): number {
  let total = 0;
  for (const [a, b] of s.pauses) total += (b ?? now) - a;
  return total;
}

/** Reloj de actividad: tiempo transcurrido sin pausas manuales (ms). */
export function timerMs(s: RecSession, now: number): number {
  if (s.startedAt == null) return 0;
  const end = s.finishedAt ?? now;
  return Math.max(0, end - s.startedAt - pausedMs(s, end));
}

/** Punto persistido durante la grabación. */
export interface RecPoint {
  sessionId: string;
  /** Epoch ms: clave natural; evita duplicados al reprocesar. */
  time: number;
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number | null;
  seg: number;
  hr?: number | null;
  power?: number | null;
  cadence?: number | null;
}

/** Construye el stream columnar final a partir de los puntos (ordenados y deduplicados por tiempo). */
export function pointsToStream(points: RecPoint[], startedAt: number): Stream {
  const sorted = points.slice().sort((a, b) => a.time - b.time);
  const s: Required<Pick<Stream, 't' | 'lat' | 'lng' | 'seg'>> & { ele: Array<number | null>; hr: Array<number | null> } = {
    t: [], lat: [], lng: [], seg: [], ele: [], hr: [],
  };
  let lastTime = -Infinity, hasEle = false, hasHr = false;
  for (const p of sorted) {
    if (p.time === lastTime) continue;
    lastTime = p.time;
    s.t.push(Math.max(0, Math.round(p.time - startedAt)));
    s.lat.push(Math.round(p.lat * 1e7) / 1e7);
    s.lng.push(Math.round(p.lng * 1e7) / 1e7);
    s.seg.push(p.seg);
    s.ele.push(p.alt != null ? Math.round(p.alt * 10) / 10 : null);
    s.hr.push(p.hr ?? null);
    if (p.alt != null) hasEle = true;
    if (p.hr != null) hasHr = true;
  }
  const out: Stream = { t: s.t, lat: s.lat, lng: s.lng, seg: s.seg };
  if (hasEle) out.ele = s.ele;
  if (hasHr) out.hr = s.hr;
  return out;
}

/**
 * Métricas en vivo, incrementales (O(1) por punto) para la pantalla de grabación.
 * El resultado definitivo se recalcula con `computeStats` al guardar.
 */
export class LiveMetrics {
  distanceM = 0;
  movingMs = 0;
  elevGainM = 0;
  private lastPoint: RecPoint | null = null;
  private eleRef: number | null = null;
  private window: Array<{ time: number; dist: number }> = [];
  private readonly threshold: number;
  splitUnit = 1000;
  splits: Array<{ index: number; timeMs: number }> = [];
  private lastSplitTime: number | null = null;

  constructor(sportKey: string) {
    this.threshold = getSport(sportKey).movingThreshold;
  }

  add(p: RecPoint) {
    const last = this.lastPoint;
    this.lastPoint = p;
    if (this.lastSplitTime == null) this.lastSplitTime = p.time;
    if (p.alt != null) {
      if (this.eleRef == null) this.eleRef = p.alt;
      else if (p.alt - this.eleRef >= 4) { this.elevGainM += p.alt - this.eleRef; this.eleRef = p.alt; }
      else if (this.eleRef - p.alt >= 4) this.eleRef = p.alt;
    }
    if (!last || last.seg !== p.seg) {
      this.window = [{ time: p.time, dist: this.distanceM }];
      return;
    }
    const d = haversine(last.lat, last.lng, p.lat, p.lng);
    const dt = p.time - last.time;
    const before = this.distanceM;
    this.distanceM += d;
    if (dt > 0 && d / (dt / 1000) >= this.threshold) this.movingMs += dt;
    const nextSplit = (this.splits.length + 1) * this.splitUnit;
    if (before < nextSplit && this.distanceM >= nextSplit) {
      const f = d > 0 ? (nextSplit - before) / d : 1;
      const at = last.time + f * dt;
      this.splits.push({ index: this.splits.length + 1, timeMs: at - this.lastSplitTime });
      this.lastSplitTime = at;
    }
    this.window.push({ time: p.time, dist: this.distanceM });
    while (this.window.length > 2 && p.time - this.window[1]!.time >= 20_000) this.window.shift();
  }

  /** Velocidad actual (m/s) sobre los últimos ~20 s, o null si no hay datos suficientes. */
  currentSpeed(now: number): number | null {
    const w = this.window;
    if (w.length < 2) return null;
    const a = w[0]!, b = w[w.length - 1]!;
    if (now - b.time > 15_000) return 0; // sin puntos recientes: parado
    const dt = (b.time - a.time) / 1000;
    return dt >= 3 ? (b.dist - a.dist) / dt : null;
  }

  /** Reconstruye el estado a partir de puntos guardados (recuperación tras cierre). */
  static fromPoints(sportKey: string, points: RecPoint[]): LiveMetrics {
    const m = new LiveMetrics(sportKey);
    for (const p of points.slice().sort((a, b) => a.time - b.time)) m.add(p);
    return m;
  }
}

export function toRecPoint(sessionId: string, fix: RawFix, seg: number): RecPoint {
  return {
    sessionId, time: fix.time, lat: fix.lat, lng: fix.lng,
    alt: fix.alt ?? null, accuracy: fix.accuracy ?? null, seg,
    hr: fix.hr ?? null, power: fix.power ?? null, cadence: fix.cadence ?? null,
  };
}
