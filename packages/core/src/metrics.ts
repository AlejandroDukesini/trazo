import { bboxOf, encodePolyline, haversine, simplifyIndices, type BBox } from './geo.js';
import type { Stream } from './schemas.js';
import { getSport, metFor, type SportDef } from './sports.js';

export const MILE_M = 1609.344;

export interface Split {
  index: number;
  distanceM: number;
  elapsedS: number;
  movingS: number;
  elevDiffM: number | null;
  avgHr: number | null;
}

export interface LapStat {
  index: number;
  startS: number;
  distanceM: number;
  elapsedS: number;
  movingS: number;
  avgHr: number | null;
}

export interface BestEffort {
  distanceM: number;
  label: string;
  elapsedS: number;
  /** Índice de inicio y fin en el stream. */
  startIndex: number;
  endIndex: number;
}

export interface ActivityStats {
  distanceM: number;
  /** Pared: desde el primer al último punto (incluye pausas). */
  elapsedS: number;
  /** Suma de la duración de cada tramo (excluye pausas). */
  timerS: number;
  movingS: number;
  elevGainM: number | null;
  elevLossM: number | null;
  eleMin: number | null;
  eleMax: number | null;
  avgSpeed: number;
  maxSpeed: number;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  maxPower: number | null;
  avgCadence: number | null;
  polyline: string;
  bbox: BBox | null;
  start: [number, number] | null;
  end: [number, number] | null;
  splits: Split[];
  splitsImperial: Split[];
  laps: LapStat[];
  bestEfforts: BestEffort[];
  pointCount: number;
}

export const BEST_EFFORT_DISTANCES: Record<SportDef['group'], Array<[number, string]>> = {
  foot: [[400, '400 m'], [1000, '1 km'], [MILE_M, '1 milla'], [5000, '5 km'], [10000, '10 km'], [21097.5, 'Media maratón'], [42195, 'Maratón']],
  ride: [[5000, '5 km'], [10000, '10 km'], [20000, '20 km'], [40000, '40 km'], [100000, '100 km']],
  other: [],
};

/** Distancia acumulada por punto. No acumula entre tramos distintos. */
export function cumulativeDistance(s: Pick<Stream, 'lat' | 'lng' | 'seg'>): Float64Array {
  const n = s.lat.length;
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const sameSeg = !s.seg || s.seg[i] === s.seg[i - 1];
    out[i] = out[i - 1]! + (sameSeg ? haversine(s.lat[i - 1]!, s.lng[i - 1]!, s.lat[i]!, s.lng[i]!) : 0);
  }
  return out;
}

/** Mediana móvil de ventana impar (ignora nulos). */
function medianFilter(values: number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  const out = new Array<number>(values.length);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    buf.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) buf.push(values[j]!);
    buf.sort((a, b) => a - b);
    out[i] = buf[buf.length >> 1]!;
  }
  return out;
}

/**
 * Desnivel acumulado: mediana móvil (5) + histéresis de `threshold` metros.
 * Evita sumar el ruido de altitud típico del GPS.
 */
export function elevationGainLoss(ele: ReadonlyArray<number | null> | undefined, threshold = 3) {
  const vals = (ele ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length < 2) return { gain: null, loss: null, min: vals[0] ?? null, max: vals[0] ?? null };
  const sm = medianFilter(vals);
  let gain = 0, loss = 0, ref = sm[0]!, min = Infinity, max = -Infinity;
  for (const v of sm) {
    if (v < min) min = v;
    if (v > max) max = v;
    if (v - ref >= threshold) { gain += v - ref; ref = v; }
    else if (ref - v >= threshold) { loss += ref - v; ref = v; }
  }
  return { gain: round1(gain), loss: round1(loss), min: round1(min), max: round1(max) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function avgOf(arr: ReadonlyArray<number | null> | undefined, from = 0, to = arr?.length ?? 0, skipZero = false) {
  if (!arr) return null;
  let sum = 0, n = 0;
  for (let i = from; i < to; i++) {
    const v = arr[i];
    if (v == null || (skipZero && v === 0)) continue;
    sum += v;
    n++;
  }
  return n ? sum / n : null;
}

function maxOf(arr: ReadonlyArray<number | null> | undefined) {
  if (!arr) return null;
  let m: number | null = null;
  for (const v of arr) if (v != null && (m == null || v > m)) m = v;
  return m;
}

/** Tiempo en movimiento acumulado por punto (s), usando la velocidad media de una ventana de ≥ 10 s. */
export function cumulativeMoving(t: ArrayLike<number>, dist: Float64Array, seg: ArrayLike<number> | undefined, threshold: number): Float64Array {
  const n = t.length;
  const out = new Float64Array(n);
  let k = 0;
  for (let i = 1; i < n; i++) {
    out[i] = out[i - 1]!;
    if (seg && seg[i] !== seg[i - 1]) { k = i; continue; }
    const dt = (t[i]! - t[i - 1]!) / 1000;
    if (dt <= 0) continue;
    while (k < i - 1 && t[i]! - t[k + 1]! >= 10_000 && (!seg || seg[k + 1] === seg[i])) k++;
    if (seg && seg[k] !== seg[i]) k = i - 1;
    const wdt = (t[i]! - t[k]!) / 1000;
    const pairSpeed = (dist[i]! - dist[i - 1]!) / dt;
    const winSpeed = wdt > 0 ? (dist[i]! - dist[k]!) / wdt : pairSpeed;
    // Un hueco largo (sin puntos) solo cuenta como movimiento si su propia velocidad lo justifica.
    const speed = dt > 10 ? pairSpeed : winSpeed;
    if (speed >= threshold) out[i] = out[i]! + dt;
  }
  return out;
}

function lowerBound(arr: ArrayLike<number>, value: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Interpola un array `ys` en la posición `x` de `xs` (ascendente). */
function interpAt(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const i = lowerBound(xs, x);
  if (i <= 0) return ys[0]!;
  if (i >= xs.length) return ys[xs.length - 1]!;
  const x0 = xs[i - 1]!, x1 = xs[i]!;
  const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  return ys[i - 1]! + f * (ys[i]! - ys[i - 1]!);
}

export function computeSplits(s: Stream, dist: Float64Array, moving: Float64Array, unit: number): Split[] {
  const n = s.t.length;
  const total = n ? dist[n - 1]! : 0;
  const splits: Split[] = [];
  const t = s.t;
  const eleAt = (d: number) => {
    if (!s.ele) return null;
    const i = Math.min(n - 1, lowerBound(dist, d));
    for (let j = i; j >= 0; j--) if (s.ele[j] != null) return s.ele[j]!;
    return null;
  };
  let prevD = 0, prevT = t[0] ?? 0, prevM = 0;
  for (let k = 1; prevD < total; k++) {
    const d = Math.min(k * unit, total);
    if (d - prevD < 10 && d === total) break; // ignora un parcial residual minúsculo
    const tAt = interpAt(dist, t, d);
    const mAt = interpAt(dist, moving, d);
    const i0 = lowerBound(dist, prevD), i1 = lowerBound(dist, d);
    const e0 = eleAt(prevD), e1 = eleAt(d);
    const hr = avgOf(s.hr, i0, Math.min(n, i1 + 1));
    splits.push({
      index: k,
      distanceM: d - prevD,
      elapsedS: (tAt - prevT) / 1000,
      movingS: mAt - prevM,
      elevDiffM: e0 != null && e1 != null ? round1(e1 - e0) : null,
      avgHr: hr != null ? Math.round(hr) : null,
    });
    prevD = d; prevT = tAt; prevM = mAt;
  }
  return splits;
}

/** Mejor tiempo para cubrir exactamente `target` metros (ventana deslizante con interpolación). */
export function bestEffort(t: ArrayLike<number>, dist: Float64Array, target: number): { elapsedS: number; startIndex: number; endIndex: number } | null {
  const n = t.length;
  if (n < 2 || dist[n - 1]! < target) return null;
  let best = Infinity, bs = 0, be = 0, j = 0;
  for (let i = 1; i < n; i++) {
    if (dist[i]! < target) continue;
    while (j + 1 < i && dist[i]! - dist[j + 1]! >= target) j++;
    // El inicio exacto está entre j y j+1.
    const startD = dist[i]! - target;
    const d0 = dist[j]!, d1 = dist[j + 1]!;
    const f = d1 === d0 ? 0 : (startD - d0) / (d1 - d0);
    const tStart = t[j]! + f * (t[j + 1]! - t[j]!);
    const el = (t[i]! - tStart) / 1000;
    if (el < best) { best = el; bs = j; be = i; }
  }
  return Number.isFinite(best) ? { elapsedS: Math.round(best * 10) / 10, startIndex: bs, endIndex: be } : null;
}

function computeLaps(s: Stream, dist: Float64Array, moving: Float64Array, lapMarks: number[]): LapStat[] {
  const n = s.t.length;
  if (!n || !lapMarks.length) return [];
  const end = s.t[n - 1]!;
  const bounds = [0, ...lapMarks.filter((m) => m > 0 && m < end).sort((a, b) => a - b), end];
  const laps: LapStat[] = [];
  for (let k = 1; k < bounds.length; k++) {
    const a = bounds[k - 1]!, b = bounds[k]!;
    const i0 = lowerBound(s.t, a), i1 = Math.min(n - 1, lowerBound(s.t, b));
    const hr = avgOf(s.hr, i0, i1 + 1);
    laps.push({
      index: k,
      startS: a / 1000,
      distanceM: interpAt(s.t, dist, b) - interpAt(s.t, dist, a),
      elapsedS: (b - a) / 1000,
      movingS: interpAt(s.t, moving, b) - interpAt(s.t, moving, a),
      avgHr: hr != null ? Math.round(hr) : null,
    });
  }
  return laps;
}

/** Velocidad máxima usando ventanas de ≥ 4 s para no registrar picos de ruido. */
function maxWindowSpeed(t: ArrayLike<number>, dist: Float64Array, seg: ArrayLike<number> | undefined, cap: number): number {
  let max = 0, k = 0;
  for (let i = 1; i < t.length; i++) {
    if (seg && seg[i] !== seg[k]) { k = i; continue; }
    while (k < i && t[i]! - t[k + 1]! >= 4000 && (!seg || seg[k + 1] === seg[i])) k++;
    const dt = (t[i]! - t[k]!) / 1000;
    if (dt >= 4 && dt <= 30) {
      const v = (dist[i]! - dist[k]!) / dt;
      if (v > max && v <= cap) max = v;
    }
  }
  return max;
}

export interface ComputeOptions {
  lapMarks?: number[];
  polylineTolerance?: number;
}

export function computeStats(stream: Stream, sportKey: string, opts: ComputeOptions = {}): ActivityStats {
  const sport = getSport(sportKey);
  const n = stream.t.length;
  const dist = cumulativeDistance(stream);
  const moving = cumulativeMoving(stream.t, dist, stream.seg, sport.movingThreshold);
  const distanceM = n ? dist[n - 1]! : 0;
  const elapsedS = n ? (stream.t[n - 1]! - stream.t[0]!) / 1000 : 0;
  let timerS = 0;
  for (let i = 1; i < n; i++) {
    if (!stream.seg || stream.seg[i] === stream.seg[i - 1]) timerS += (stream.t[i]! - stream.t[i - 1]!) / 1000;
  }
  const movingS = n ? moving[n - 1]! : 0;
  const elev = elevationGainLoss(stream.ele);
  const keep = simplifyIndices(stream.lat, stream.lng, opts.polylineTolerance ?? 4);
  const polyline = encodePolyline(keep.map((i) => [stream.lat[i]!, stream.lng[i]!] as const));
  const efforts: BestEffort[] = [];
  for (const [d, label] of BEST_EFFORT_DISTANCES[sport.group]) {
    const be = bestEffort(stream.t, dist, d);
    if (be) efforts.push({ distanceM: d, label, ...be });
  }
  const avgHr = avgOf(stream.hr);
  const avgPower = avgOf(stream.power);
  const avgCad = avgOf(stream.cadence, 0, n, true);
  return {
    distanceM: round1(distanceM),
    elapsedS: Math.round(elapsedS),
    timerS: Math.round(timerS),
    movingS: Math.round(movingS),
    elevGainM: elev.gain,
    elevLossM: elev.loss,
    eleMin: elev.min,
    eleMax: elev.max,
    avgSpeed: movingS > 0 ? distanceM / movingS : 0,
    maxSpeed: maxWindowSpeed(stream.t, dist, stream.seg, sport.maxSpeed),
    avgHr: avgHr != null ? Math.round(avgHr) : null,
    maxHr: maxOf(stream.hr),
    avgPower: avgPower != null ? Math.round(avgPower) : null,
    maxPower: maxOf(stream.power),
    avgCadence: avgCad != null ? Math.round(avgCad) : null,
    polyline,
    bbox: bboxOf(stream.lat, stream.lng),
    start: n ? [stream.lat[0]!, stream.lng[0]!] : null,
    end: n ? [stream.lat[n - 1]!, stream.lng[n - 1]!] : null,
    splits: computeSplits(stream, dist, moving, 1000),
    splitsImperial: computeSplits(stream, dist, moving, MILE_M),
    laps: computeLaps(stream, dist, moving, opts.lapMarks ?? []),
    bestEfforts: efforts,
    pointCount: n,
  };
}

/**
 * Calorías ESTIMADAS: MET × peso × horas en movimiento. Devuelve null si no se conoce el peso:
 * no inventamos datos fisiológicos.
 */
export function estimateCalories(sportKey: string, movingS: number, distanceM: number, weightKg: number | null | undefined): number | null {
  if (!weightKg || movingS <= 0) return null;
  const sport = getSport(sportKey);
  const met = metFor(sport, distanceM / movingS);
  return Math.round(met * weightKg * (movingS / 3600));
}

/** Series derivadas para gráficos: distancia, velocidad suavizada (m/s), elevación. */
export function chartSeries(stream: Stream, maxPoints = 1500) {
  const n = stream.t.length;
  const dist = cumulativeDistance(stream);
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const x: number[] = [], time: number[] = [], speed: Array<number | null> = [], ele: Array<number | null> = [];
  const hr: Array<number | null> = [], power: Array<number | null> = [], cadence: Array<number | null> = [];
  let k = 0;
  for (let i = 0; i < n; i += step) {
    while (k < i && stream.t[i]! - stream.t[k + 1]! >= 15_000) k++;
    const dt = (stream.t[i]! - stream.t[k]!) / 1000;
    const sameSeg = !stream.seg || stream.seg[i] === stream.seg[k];
    x.push(dist[i]!);
    time.push(stream.t[i]! / 1000);
    speed.push(dt > 0 && sameSeg ? (dist[i]! - dist[k]!) / dt : null);
    ele.push(stream.ele?.[i] ?? null);
    hr.push(stream.hr?.[i] ?? null);
    power.push(stream.power?.[i] ?? null);
    cadence.push(stream.cadence?.[i] ?? null);
  }
  return { x, time, speed, ele, hr, power, cadence, step };
}
