import { XMLParser } from 'fast-xml-parser';
import { cumulativeDistance } from './metrics.js';
import type { Stream } from './schemas.js';
import { getSport } from './sports.js';

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ParsedPoint {
  lat: number;
  lng: number;
  ele: number | null;
  time: number | null;
  hr: number | null;
  cadence: number | null;
  power: number | null;
  seg: number;
}

export interface ParsedFile {
  format: 'gpx' | 'tcx';
  name: string | null;
  sport: string | null;
  points: ParsedPoint[];
  /** true si todos los puntos tienen hora (es una actividad, no solo una ruta). */
  timed: boolean;
}

const ARRAY_TAGS = new Set(['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'wpt', 'Activity', 'Lap', 'Track', 'Trackpoint', 'Course']);

function parser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    // Sin expansión de entidades: defensa frente a "billion laughs"/XXE.
    processEntities: false,
    parseTagValue: false,
    isArray: (name) => ARRAY_TAGS.has(name),
  });
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return decodeXml(v.trim());
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return text((v as Record<string, unknown>)['#text']);
  return null;
}

function num(v: unknown): number | null {
  const t = text(v);
  if (t == null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function time(v: unknown): number | null {
  const t = text(v);
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** Busca recursivamente la primera clave `key` dentro de extensiones con espacios de nombres variados. */
function findDeep(obj: unknown, key: string, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
  const rec = obj as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const v of Object.values(rec)) {
    const found = findDeep(v, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function mapSport(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/trail/.test(s)) return 'trail_run';
  if (/run|carrera|correr/.test(s)) return 'run';
  if (/mountain|mtb|btt/.test(s)) return 'mtb';
  if (/bik|cycl|ride|ciclis|bici/.test(s)) return 'ride';
  if (/hik|sender|trek/.test(s)) return 'hike';
  if (/walk|camin/.test(s)) return 'walk';
  if (/swim|nata/.test(s)) return 'swim';
  return null;
}

function guard(xml: string) {
  if (xml.length > MAX_IMPORT_BYTES) throw new ImportError('El archivo supera el tamaño máximo (15 MB).');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ImportError('El archivo contiene declaraciones XML no permitidas.');
}

function validPoint(lat: number | null, lng: number | null): lat is number {
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function parseGpx(xml: string): ParsedFile {
  guard(xml);
  const doc = parser().parse(xml) as Record<string, any>;
  const gpx = doc.gpx;
  if (!gpx) throw new ImportError('No es un archivo GPX válido.');
  const points: ParsedPoint[] = [];
  let name: string | null = null, type: string | null = null, seg = 0;
  for (const trk of gpx.trk ?? []) {
    name ??= text(trk.name);
    type ??= text(trk.type);
    for (const ts of trk.trkseg ?? []) {
      for (const p of ts.trkpt ?? []) {
        const lat = num(p['@_lat']), lng = num(p['@_lon']);
        if (!validPoint(lat, lng)) continue;
        const ext = p.extensions;
        points.push({
          lat, lng: lng!, ele: num(p.ele), time: time(p.time),
          hr: num(findDeep(ext, 'hr')), cadence: num(findDeep(ext, 'cad')), power: num(findDeep(ext, 'power')),
          seg,
        });
      }
      seg++;
    }
  }
  if (!points.length) {
    for (const rte of gpx.rte ?? []) {
      name ??= text(rte.name);
      for (const p of rte.rtept ?? []) {
        const lat = num(p['@_lat']), lng = num(p['@_lon']);
        if (!validPoint(lat, lng)) continue;
        points.push({ lat, lng: lng!, ele: num(p.ele), time: time(p.time), hr: null, cadence: null, power: null, seg: 0 });
      }
    }
  }
  name ??= text(gpx.metadata?.name);
  if (!points.length) throw new ImportError('El archivo GPX no contiene puntos de recorrido.');
  return { format: 'gpx', name, sport: mapSport(type), points, timed: points.every((p) => p.time != null) };
}

export function parseTcx(xml: string): ParsedFile {
  guard(xml);
  const doc = parser().parse(xml) as Record<string, any>;
  const root = doc.TrainingCenterDatabase;
  if (!root) throw new ImportError('No es un archivo TCX válido.');
  const points: ParsedPoint[] = [];
  let sport: string | null = null, name: string | null = null, seg = 0;
  const activities = root.Activities?.Activity ?? [];
  const courses = root.Courses?.Course ?? [];
  for (const act of activities) {
    sport ??= mapSport(act['@_Sport']);
    for (const lap of act.Lap ?? []) {
      for (const track of lap.Track ?? []) {
        for (const tp of track.Trackpoint ?? []) {
          const lat = num(tp.Position?.LatitudeDegrees), lng = num(tp.Position?.LongitudeDegrees);
          if (!validPoint(lat, lng)) continue;
          points.push({
            lat, lng: lng!, ele: num(tp.AltitudeMeters), time: time(tp.Time),
            hr: num(tp.HeartRateBpm?.Value), cadence: num(tp.Cadence) ?? num(findDeep(tp.Extensions, 'RunCadence')),
            power: num(findDeep(tp.Extensions, 'Watts')), seg,
          });
        }
        seg++;
      }
    }
  }
  for (const c of courses) {
    name ??= text(c.Name);
    for (const track of c.Track ?? []) {
      for (const tp of track.Trackpoint ?? []) {
        const lat = num(tp.Position?.LatitudeDegrees), lng = num(tp.Position?.LongitudeDegrees);
        if (!validPoint(lat, lng)) continue;
        points.push({ lat, lng: lng!, ele: num(tp.AltitudeMeters), time: time(tp.Time), hr: null, cadence: null, power: null, seg });
      }
    }
  }
  if (!points.length) throw new ImportError('El archivo TCX no contiene puntos con posición.');
  return { format: 'tcx', name, sport, points, timed: points.every((p) => p.time != null) };
}

export function parseTrackFile(fileName: string, content: string): ParsedFile {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gpx')) return parseGpx(content);
  if (lower.endsWith('.tcx')) return parseTcx(content);
  const head = content.slice(0, 2000);
  if (head.includes('<gpx')) return parseGpx(content);
  if (head.includes('TrainingCenterDatabase')) return parseTcx(content);
  throw new ImportError('Formato no compatible. Usa archivos .gpx o .tcx.');
}

/**
 * Convierte un archivo con horas en stream de actividad: ordena, elimina duplicados de tiempo
 * y descarta saltos imposibles para el deporte (los archivos de dispositivos ya vienen filtrados,
 * así que solo se eliminan errores groseros).
 */
export function parsedToStream(parsed: ParsedFile, sportKey: string): { stream: Stream; startedAt: number; dropped: number } {
  if (!parsed.timed) throw new ImportError('El archivo no tiene marcas de tiempo: impórtalo como ruta.');
  const maxSpeed = getSport(sportKey).maxSpeed * 1.5;
  const pts = parsed.points.slice().sort((a, b) => a.time! - b.time!);
  const startedAt = pts[0]!.time!;
  const out: ParsedPoint[] = [];
  let dropped = 0;
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last) {
      if (p.time! <= last.time!) { dropped++; continue; }
      const dt = (p.time! - last.time!) / 1000;
      const d = cumulativeDistance({ lat: [last.lat, p.lat], lng: [last.lng, p.lng] })[1]!;
      if (d / dt > maxSpeed && d > 100) { dropped++; continue; }
    }
    out.push(p);
  }
  const has = (k: 'ele' | 'hr' | 'power' | 'cadence') => out.some((p) => p[k] != null);
  const stream: Stream = {
    t: out.map((p) => p.time! - startedAt),
    lat: out.map((p) => p.lat),
    lng: out.map((p) => p.lng),
    seg: out.map((p) => p.seg),
  };
  if (has('ele')) stream.ele = out.map((p) => p.ele);
  if (has('hr')) stream.hr = out.map((p) => (p.hr != null && p.hr >= 20 && p.hr <= 250 ? p.hr : null));
  if (has('power')) stream.power = out.map((p) => (p.power != null && p.power >= 0 && p.power <= 3000 ? p.power : null));
  if (has('cadence')) stream.cadence = out.map((p) => (p.cadence != null && p.cadence >= 0 && p.cadence <= 300 ? p.cadence : null));
  return { stream, startedAt, dropped };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ExportMeta {
  name: string;
  sport: string;
  startedAt: number;
  description?: string;
}

export function streamToGpx(stream: Stream, meta: ExportMeta): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="Trazo" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">');
  lines.push(`  <metadata><name>${esc(meta.name)}</name><time>${new Date(meta.startedAt).toISOString()}</time></metadata>`);
  lines.push(`  <trk><name>${esc(meta.name)}</name><type>${esc(meta.sport)}</type>`);
  if (meta.description) lines.push(`    <desc>${esc(meta.description)}</desc>`);
  let curSeg: number | null = null;
  for (let i = 0; i < stream.t.length; i++) {
    const seg = stream.seg?.[i] ?? 0;
    if (seg !== curSeg) {
      if (curSeg != null) lines.push('    </trkseg>');
      lines.push('    <trkseg>');
      curSeg = seg;
    }
    const ele = stream.ele?.[i];
    const hr = stream.hr?.[i], cad = stream.cadence?.[i];
    let pt = `      <trkpt lat="${stream.lat[i]}" lon="${stream.lng[i]}">`;
    if (ele != null) pt += `<ele>${ele}</ele>`;
    pt += `<time>${new Date(meta.startedAt + stream.t[i]!).toISOString()}</time>`;
    if (hr != null || cad != null) {
      pt += '<extensions><gpxtpx:TrackPointExtension>';
      if (hr != null) pt += `<gpxtpx:hr>${Math.round(hr)}</gpxtpx:hr>`;
      if (cad != null) pt += `<gpxtpx:cad>${Math.round(cad)}</gpxtpx:cad>`;
      pt += '</gpxtpx:TrackPointExtension></extensions>';
    }
    lines.push(pt + '</trkpt>');
  }
  if (curSeg != null) lines.push('    </trkseg>');
  lines.push('  </trk>', '</gpx>');
  return lines.join('\n');
}

const TCX_SPORT: Record<string, string> = { run: 'Running', trail_run: 'Running', walk: 'Running', hike: 'Running', ride: 'Biking', mtb: 'Biking' };

export function streamToTcx(stream: Stream, meta: ExportMeta): string {
  const dist = cumulativeDistance(stream);
  const n = stream.t.length;
  const start = new Date(meta.startedAt).toISOString();
  const totalS = n ? stream.t[n - 1]! / 1000 : 0;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">');
  lines.push(`  <Activities><Activity Sport="${TCX_SPORT[meta.sport] ?? 'Other'}"><Id>${start}</Id>`);
  lines.push(`    <Lap StartTime="${start}"><TotalTimeSeconds>${totalS.toFixed(1)}</TotalTimeSeconds><DistanceMeters>${(n ? dist[n - 1]! : 0).toFixed(1)}</DistanceMeters><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>`);
  for (let i = 0; i < n; i++) {
    let tp = `      <Trackpoint><Time>${new Date(meta.startedAt + stream.t[i]!).toISOString()}</Time><Position><LatitudeDegrees>${stream.lat[i]}</LatitudeDegrees><LongitudeDegrees>${stream.lng[i]}</LongitudeDegrees></Position>`;
    const ele = stream.ele?.[i];
    if (ele != null) tp += `<AltitudeMeters>${ele}</AltitudeMeters>`;
    tp += `<DistanceMeters>${dist[i]!.toFixed(1)}</DistanceMeters>`;
    const hr = stream.hr?.[i];
    if (hr != null) tp += `<HeartRateBpm><Value>${Math.round(hr)}</Value></HeartRateBpm>`;
    const cad = stream.cadence?.[i];
    if (cad != null) tp += `<Cadence>${Math.round(cad)}</Cadence>`;
    const w = stream.power?.[i];
    if (w != null) tp += `<Extensions><ns3:TPX><ns3:Watts>${Math.round(w)}</ns3:Watts></ns3:TPX></Extensions>`;
    lines.push(tp + '</Trackpoint>');
  }
  lines.push('    </Track></Lap>');
  if (meta.description) lines.push(`    <Notes>${esc(meta.description)}</Notes>`);
  lines.push('  </Activity></Activities>', '</TrainingCenterDatabase>');
  return lines.join('\n');
}

export function routeToGpx(name: string, lat: number[], lng: number[], ele?: Array<number | null>): string {
  const pts = lat
    .map((la, i) => {
      const e = ele?.[i];
      return `      <trkpt lat="${la}" lon="${lng[i]}">${e != null ? `<ele>${e}</ele>` : ''}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trazo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk><name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}
