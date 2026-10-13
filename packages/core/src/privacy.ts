import { bboxOf, encodePolyline, haversine, simplifyIndices } from './geo.js';
import type { Stream } from './schemas.js';

export interface PrivacyZone {
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * Elimina del recorrido todos los puntos dentro de cualquier zona privada del propietario.
 * Se aplica en el servidor antes de enviar coordenadas a cualquier otra persona.
 */
export function applyPrivacyZones(stream: Stream, zones: PrivacyZone[]): Stream {
  if (!zones.length) return stream;
  const keep: number[] = [];
  for (let i = 0; i < stream.t.length; i++) {
    const la = stream.lat[i]!, ln = stream.lng[i]!;
    if (!zones.some((z) => haversine(la, ln, z.lat, z.lng) <= z.radiusM)) keep.push(i);
  }
  if (keep.length === stream.t.length) return stream;
  const pick = <T>(arr: T[] | undefined) => (arr ? keep.map((i) => arr[i]!) : undefined);
  // Un hueco creado por la zona abre tramo nuevo para no dibujar una línea a través de ella.
  const seg: number[] = [];
  let extra = 0;
  keep.forEach((idx, k) => {
    if (k > 0 && idx !== keep[k - 1]! + 1) extra++;
    seg.push((stream.seg?.[idx] ?? 0) + extra);
  });
  const out: Stream = { t: pick(stream.t)!, lat: pick(stream.lat)!, lng: pick(stream.lng)!, seg };
  if (stream.ele) out.ele = pick(stream.ele);
  if (stream.hr) out.hr = pick(stream.hr);
  if (stream.power) out.power = pick(stream.power);
  if (stream.cadence) out.cadence = pick(stream.cadence);
  return out;
}

/** Polilínea pública (simplificada) tras aplicar zonas privadas. */
export function publicPolyline(stream: Stream, zones: PrivacyZone[]) {
  const s = applyPrivacyZones(stream, zones);
  const keep = simplifyIndices(s.lat, s.lng, 4);
  return {
    polyline: encodePolyline(keep.map((i) => [s.lat[i]!, s.lng[i]!] as const)),
    bbox: bboxOf(s.lat, s.lng),
    start: s.lat.length ? ([s.lat[0]!, s.lng[0]!] as [number, number]) : null,
  };
}
