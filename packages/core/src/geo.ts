export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Distancia ortodrómica (haversine) en metros. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distance(a: LatLng, b: LatLng): number {
  return haversine(a.lat, a.lng, b.lat, b.lng);
}

/**
 * Distancia (m) de un punto P al segmento AB. Proyección equirectangular local:
 * precisa para segmentos cortos (< pocos km), que es el caso de trazas GPS.
 */
export function pointToSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const cos = Math.cos(p.lat * RAD);
  const ax = (a.lng - p.lng) * cos, ay = a.lat - p.lat;
  const bx = (b.lng - p.lng) * cos, by = b.lat - p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * RAD * EARTH_RADIUS_M;
}

export function bboxOf(lat: ArrayLike<number>, lng: ArrayLike<number>): BBox | null {
  if (lat.length === 0) return null;
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (let i = 0; i < lat.length; i++) {
    const la = lat[i]!, ln = lng[i]!;
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  return { minLat, minLng, maxLat, maxLng };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

/** Amplía una bbox `meters` metros en todas direcciones. */
export function expandBBox(b: BBox, meters: number): BBox {
  const dLat = meters / (EARTH_RADIUS_M * RAD);
  const dLng = dLat / Math.max(0.01, Math.cos(((b.minLat + b.maxLat) / 2) * RAD));
  return { minLat: b.minLat - dLat, maxLat: b.maxLat + dLat, minLng: b.minLng - dLng, maxLng: b.maxLng + dLng };
}

/**
 * Simplificación Douglas–Peucker iterativa. Devuelve los índices conservados.
 * `tolerance` en metros.
 */
export function simplifyIndices(lat: ArrayLike<number>, lng: ArrayLike<number>, tolerance: number): number[] {
  const n = lat.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    const a = { lat: lat[s]!, lng: lng[s]! }, b = { lat: lat[e]!, lng: lng[e]! };
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegmentDistance({ lat: lat[i]!, lng: lng[i]! }, a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Codificación de polilíneas (algoritmo de polilínea codificada, precisión 1e-5). */
export function encodePolyline(points: ReadonlyArray<readonly [number, number]>, precision = 5): string {
  const f = 10 ** precision;
  let out = '', pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [la, ln] of points) {
    const lat = Math.round(la * f), lng = Math.round(ln * f);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

export function decodePolyline(str: string, precision = 5): Array<[number, number]> {
  const f = 10 ** precision;
  const out: Array<[number, number]> = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < str.length + 1);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    out.push([lat / f, lng / f]);
  }
  return out;
}
