import { haversine } from './geo.js';
import { getSport, type SportDef } from './sports.js';

/** Posición tal como la entrega el dispositivo (web o nativo). */
export interface RawFix {
  lat: number;
  lng: number;
  /** Altitud en metros (puede faltar). */
  alt?: number | null;
  /** Precisión horizontal en metros (radio 68 %). */
  accuracy?: number | null;
  speed?: number | null;
  /** Epoch ms. */
  time: number;
  hr?: number | null;
  power?: number | null;
  cadence?: number | null;
}

export type RejectReason = 'invalid' | 'accuracy' | 'time' | 'duplicate' | 'stationary' | 'jump';

export type FilterResult =
  | { accepted: true; newSegment: boolean }
  | { accepted: false; reason: RejectReason };

export interface GpsFilterOptions {
  /** Precisión máxima aceptada (m). */
  maxAccuracy?: number;
  /** Tras una pérdida de señal de más de este tiempo, empieza tramo nuevo (ms). */
  gapForNewSegmentMs?: number;
}

/**
 * Filtro incremental de posiciones GPS: O(1) por punto.
 * - descarta precisión pobre, marcas de tiempo repetidas/retrocedidas y coordenadas inválidas;
 * - descarta el "baile" estando parado (desplazamiento menor que el ruido esperado);
 * - descarta saltos con velocidad implícita imposible para el deporte;
 * - si varios puntos consecutivos "saltados" son coherentes entre sí, asume que el error estaba en el
 *   ancla (p. ej. tras un túnel) y reengancha abriendo un tramo nuevo sin sumar la distancia del salto.
 */
export class GpsFilter {
  private last: RawFix | null = null;
  private pending: RawFix[] = [];
  private readonly sport: SportDef;
  private readonly maxAccuracy: number;
  private readonly gapMs: number;
  stats = { accepted: 0, rejected: {} as Partial<Record<RejectReason, number>> };

  constructor(sportKey: string, opts: GpsFilterOptions = {}) {
    this.sport = getSport(sportKey);
    this.maxAccuracy = opts.maxAccuracy ?? 35;
    this.gapMs = opts.gapForNewSegmentMs ?? 120_000;
  }

  /** Reinicia el ancla (p. ej. al reanudar tras pausa: el siguiente punto abre tramo). */
  reset(last: RawFix | null = null) {
    this.last = last;
    this.pending = [];
  }

  get lastAccepted(): RawFix | null {
    return this.last;
  }

  push(fix: RawFix): FilterResult {
    const r = this.evaluate(fix);
    if (r.accepted) this.stats.accepted++;
    else this.stats.rejected[r.reason] = (this.stats.rejected[r.reason] ?? 0) + 1;
    return r;
  }

  private evaluate(fix: RawFix): FilterResult {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 || (fix.lat === 0 && fix.lng === 0)) {
      return { accepted: false, reason: 'invalid' };
    }
    const acc = fix.accuracy ?? 10;
    if (acc > this.maxAccuracy) return { accepted: false, reason: 'accuracy' };
    const last = this.last;
    if (!last) {
      this.last = fix;
      return { accepted: true, newSegment: false };
    }
    if (fix.time <= last.time) return { accepted: false, reason: 'time' };
    const dt = (fix.time - last.time) / 1000;
    const d = haversine(last.lat, last.lng, fix.lat, fix.lng);
    if (d < 0.5 && dt < 1.5) return { accepted: false, reason: 'duplicate' };

    const lastAcc = last.accuracy ?? 10;
    // Tolerancia: la incertidumbre combinada de ambos puntos puede justificar parte del salto.
    const tolerance = Math.min(acc + lastAcc, 60);
    const implied = Math.max(0, d - tolerance) / dt;
    if (implied > this.sport.maxSpeed) {
      this.pending.push(fix);
      if (this.pending.length > 6) this.pending.shift();
      if (this.isPendingConsistent()) {
        this.last = fix;
        this.pending = [];
        return { accepted: true, newSegment: true };
      }
      return { accepted: false, reason: 'jump' };
    }
    this.pending = [];

    // Quieto: desplazamiento inferior al ruido esperado. Se conserva un punto cada 30 s para el tiempo.
    const minMove = Math.max(1.5, Math.min(acc, 12) * 0.4);
    const reportedStill = fix.speed != null && fix.speed >= 0 && fix.speed < this.sport.movingThreshold * 0.5;
    if (d < minMove && dt < 30 && (reportedStill || fix.speed == null)) {
      return { accepted: false, reason: 'stationary' };
    }

    const newSegment = fix.time - last.time > this.gapMs;
    this.last = fix;
    return { accepted: true, newSegment };
  }

  /** ¿Los últimos 4 puntos pendientes forman una trayectoria plausible entre sí? */
  private isPendingConsistent(): boolean {
    if (this.pending.length < 4) return false;
    const p = this.pending.slice(-4);
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!, b = p[i]!;
      const dt = (b.time - a.time) / 1000;
      if (dt <= 0) return false;
      const tol = Math.min((a.accuracy ?? 10) + (b.accuracy ?? 10), 60);
      if (Math.max(0, haversine(a.lat, a.lng, b.lat, b.lng) - tol) / dt > this.sport.maxSpeed) return false;
    }
    return true;
  }
}
