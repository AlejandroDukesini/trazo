import { haversine, pointToSegmentDistance, type BBox } from './geo.js';
import { cumulativeDistance } from './metrics.js';
import type { Stream } from './schemas.js';
import { getSport } from './sports.js';

export interface SegmentGeometry {
  lat: number[];
  lng: number[];
  distanceM: number;
}

export interface SegmentMatch {
  startIndex: number;
  endIndex: number;
  elapsedS: number;
  distanceM: number;
  avgHr: number | null;
}

/** Radio (m) para considerar que se pasa por el inicio/fin del segmento. */
export const SEGMENT_ENDPOINT_TOLERANCE = 30;
/** Distancia máxima (m) entre la traza y cada muestra del segmento. */
export const SEGMENT_PATH_TOLERANCE = 35;

/** Remuestrea la geometría a intervalos de ~`step` metros para comprobar cobertura. */
export function resample(lat: number[], lng: number[], step = 40): Array<{ lat: number; lng: number }> {
  const out = [{ lat: lat[0]!, lng: lng[0]! }];
  let acc = 0;
  for (let i = 1; i < lat.length; i++) {
    const d = haversine(lat[i - 1]!, lng[i - 1]!, lat[i]!, lng[i]!);
    acc += d;
    while (acc >= step) {
      const back = acc - step;
      const f = d > 0 ? 1 - back / d : 1;
      out.push({ lat: lat[i - 1]! + f * (lat[i]! - lat[i - 1]!), lng: lng[i - 1]! + f * (lng[i]! - lng[i - 1]!) });
      acc = back;
    }
  }
  out.push({ lat: lat[lat.length - 1]!, lng: lng[lng.length - 1]! });
  return out;
}

/**
 * Detecta todos los intentos de un segmento en un recorrido.
 * Reglas:
 * 1. Pasar a ≤ 30 m del inicio (se toma el punto más cercano del paso).
 * 2. Recorrer **en orden** todas las muestras del segmento (cada 40 m) a ≤ 35 m de la traza.
 * 3. Llegar a ≤ 30 m del fin.
 * 4. La distancia recorrida debe estar entre el 85 % y el 130 % de la del segmento.
 */
export function matchSegment(stream: Stream, seg: SegmentGeometry): SegmentMatch[] {
  const n = stream.t.length;
  if (n < 2 || seg.lat.length < 2) return [];
  const dist = cumulativeDistance(stream);
  const samples = resample(seg.lat, seg.lng);
  const start = samples[0]!, end = samples[samples.length - 1]!;
  const out: SegmentMatch[] = [];
  let i = 0;
  while (i < n) {
    // 1. Buscar paso por el inicio y su punto más cercano.
    let dStart = haversine(stream.lat[i]!, stream.lng[i]!, start.lat, start.lng);
    if (dStart > SEGMENT_ENDPOINT_TOLERANCE) { i++; continue; }
    let si = i;
    while (i + 1 < n) {
      const d = haversine(stream.lat[i + 1]!, stream.lng[i + 1]!, start.lat, start.lng);
      if (d > SEGMENT_ENDPOINT_TOLERANCE) break;
      i++;
      if (d < dStart) { dStart = d; si = i; }
    }
    // 2-3. Recorrer en orden.
    let k = 1, j = si, endIdx = -1;
    const maxDist = seg.distanceM * 1.3 + 100;
    for (j = si + 1; j < n; j++) {
      if (dist[j]! - dist[si]! > maxDist) break;
      const p = { lat: stream.lat[j]!, lng: stream.lng[j]! };
      const prev = { lat: stream.lat[j - 1]!, lng: stream.lng[j - 1]! };
      while (k < samples.length && pointToSegmentDistance(samples[k]!, prev, p) <= SEGMENT_PATH_TOLERANCE) k++;
      if (k >= samples.length - 1 && haversine(p.lat, p.lng, end.lat, end.lng) <= SEGMENT_ENDPOINT_TOLERANCE) {
        // Elegir el punto más cercano al fin dentro de la zona.
        let best = j, bestD = haversine(p.lat, p.lng, end.lat, end.lng);
        for (let m = j + 1; m < n; m++) {
          const d = haversine(stream.lat[m]!, stream.lng[m]!, end.lat, end.lng);
          if (d > SEGMENT_ENDPOINT_TOLERANCE) break;
          if (d < bestD) { bestD = d; best = m; }
        }
        endIdx = best;
        break;
      }
    }
    if (endIdx > si) {
      const covered = dist[endIdx]! - dist[si]!;
      const ratio = covered / seg.distanceM;
      if (ratio >= 0.85 && ratio <= 1.3) {
        let hrSum = 0, hrN = 0;
        if (stream.hr) for (let m = si; m <= endIdx; m++) { const h = stream.hr[m]; if (h != null) { hrSum += h; hrN++; } }
        out.push({
          startIndex: si, endIndex: endIdx,
          elapsedS: Math.round((stream.t[endIdx]! - stream.t[si]!) / 100) / 10,
          distanceM: Math.round(covered),
          avgHr: hrN ? Math.round(hrSum / hrN) : null,
        });
        i = endIdx + 1;
        continue;
      }
    }
    i = si + 1;
  }
  return out;
}

/**
 * Control antifraude: un intento es sospechoso si su velocidad media supera lo plausible
 * para el deporte (p. ej. una "carrera" hecha en coche). Los intentos marcados no entran
 * en clasificaciones públicas.
 */
export function isSuspiciousEffort(sportKey: string, distanceM: number, elapsedS: number): boolean {
  if (elapsedS <= 0) return true;
  const sport = getSport(sportKey);
  return sport.maxSegmentSpeed > 0 && distanceM / elapsedS > sport.maxSegmentSpeed;
}

/** Extrae la geometría de un tramo de actividad para crear un segmento. */
export function sliceGeometry(stream: Stream, startIndex: number, endIndex: number): SegmentGeometry & { bbox: BBox; ele: Array<number | null> } {
  const lat = stream.lat.slice(startIndex, endIndex + 1);
  const lng = stream.lng.slice(startIndex, endIndex + 1);
  const dist = cumulativeDistance({ lat, lng });
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (let i = 0; i < lat.length; i++) {
    minLat = Math.min(minLat, lat[i]!); maxLat = Math.max(maxLat, lat[i]!);
    minLng = Math.min(minLng, lng[i]!); maxLng = Math.max(maxLng, lng[i]!);
  }
  return {
    lat, lng,
    distanceM: Math.round(dist[dist.length - 1] ?? 0),
    bbox: { minLat, minLng, maxLat, maxLng },
    ele: stream.ele ? stream.ele.slice(startIndex, endIndex + 1) : [],
  };
}
