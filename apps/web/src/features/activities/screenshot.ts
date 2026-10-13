/**
 * Extrae datos de actividad del texto que devuelve el OCR de un pantallazo (Strava u otra app).
 * Es heurístico y nunca fiable al 100 %: la UI SIEMPRE deja revisar y corregir antes de guardar.
 * No inventa valores: si no encuentra un dato con confianza, lo deja sin rellenar.
 */
export interface ParsedScreenshot {
  distanceKm?: number;
  durationS?: number;
  elevM?: number;
  avgHr?: number;
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));

/** Convierte "1:23:45" → s, o "45:30" → s (mm:ss). */
function hms(str: string): number | null {
  const parts = str.split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return null;
}

function parseDecimal(raw: string): number {
  // "10,5" → 10.5 · "10.5" → 10.5 · "1.234,5" → 1234.5 · "1,234.5" → 1234.5
  const t = raw.trim();
  if (/,\d{1,2}\b/.test(t) && !/\.\d/.test(t)) return num(t); // coma decimal
  if (/\.\d{1,2}\b/.test(t) && !/,\d/.test(t)) return Number(t.replace(/,/g, ''));
  return num(t);
}

export function parseScreenshot(text: string): ParsedScreenshot {
  const out: ParsedScreenshot = {};
  const lower = text.toLowerCase();

  // Distancia: número seguido de km o mi.
  const km = /(\d+(?:[.,]\d+)?)\s*km\b/i.exec(text);
  const mi = /(\d+(?:[.,]\d+)?)\s*(?:mi|mile|miles|millas)\b/i.exec(text);
  if (km) out.distanceKm = parseDecimal(km[1]!);
  else if (mi) out.distanceKm = Math.round(parseDecimal(mi[1]!) * 1.609344 * 100) / 100;

  // Duración: prefiere un tiempo cerca de palabras de tiempo; si no, el mayor h:m:s encontrado.
  const times = [...text.matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)].map((m) => m[1]!);
  const labelled = /(?:tiempo|duraci[oó]n|time|moving|en movimiento)\D{0,12}(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(text);
  if (labelled) out.durationS = hms(labelled[1]!) ?? undefined;
  else if (times.length) {
    // El tiempo total suele ser el de más dígitos / mayor valor; descartamos ritmos (mm:ss junto a /km).
    const candidates = times.map(hms).filter((n): n is number => n != null);
    if (candidates.length) out.durationS = Math.max(...candidates);
  }

  // Desnivel: cerca de palabra de elevación, número con m o ft.
  const elev = /(?:desnivel|elevaci[oó]n|elev\.?|ascenso|ascent|climb|d\+)\D{0,12}(\d+(?:[.,]\d+)?)\s*(m|ft|pies|feet)?/i.exec(text);
  if (elev) {
    const v = parseDecimal(elev[1]!);
    out.elevM = /ft|pies|feet/i.test(elev[2] ?? '') ? Math.round(v * 0.3048) : Math.round(v);
  }

  // FC media: número de 2-3 cifras junto a ppm/bpm/lpm o palabra de frecuencia.
  const hr = /(\d{2,3})\s*(?:ppm|bpm|lpm)\b/i.exec(text) ?? /(?:fc|hr|pulso|heart|frecuencia)\D{0,10}(\d{2,3})\b/i.exec(lower);
  if (hr) {
    const v = Number(hr[1]);
    if (v >= 40 && v <= 230) out.avgHr = v;
  }

  return out;
}
