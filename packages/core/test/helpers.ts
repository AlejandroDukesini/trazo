import type { Stream } from '../src/index.js';

const M_PER_DEG_LAT = 111_194.93; // R·π/180 con R = 6 371 008.8

/** Traza sintética recta hacia el norte a velocidad constante (m/s), un punto por `stepS` segundos. */
export function straightStream(opts: { meters: number; speed: number; stepS?: number; lat0?: number; lng0?: number; ele?: (i: number) => number | null; hr?: number }): Stream {
  const step = opts.stepS ?? 1;
  const lat0 = opts.lat0 ?? 40.4168, lng0 = opts.lng0 ?? -3.7038;
  const n = Math.floor(opts.meters / (opts.speed * step)) + 1;
  const s: Stream = { t: [], lat: [], lng: [], seg: [] };
  const ele: Array<number | null> = [], hr: Array<number | null> = [];
  for (let i = 0; i < n; i++) {
    const d = i * opts.speed * step;
    s.t.push(i * step * 1000);
    s.lat.push(lat0 + d / M_PER_DEG_LAT);
    s.lng.push(lng0);
    s.seg!.push(0);
    ele.push(opts.ele ? opts.ele(i) : null);
    hr.push(opts.hr ?? null);
  }
  if (opts.ele) s.ele = ele;
  if (opts.hr) s.hr = hr;
  return s;
}

export function metersNorth(lat: number, m: number) {
  return lat + m / M_PER_DEG_LAT;
}
