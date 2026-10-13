import { describe, expect, it } from 'vitest';
import {
  ActivityCreateSchema, GpsFilter, LiveMetrics, StreamSchema, applyPrivacyZones, bestEffort, computeStats,
  createSession, cumulativeDistance, decodePolyline, elevationGainLoss, encodePolyline, entitlementsFor,
  estimateCalories, fitnessSeries, formatDuration, formatPace, haversine, hasFeature, matchSegment,
  isSuspiciousEffort, parseGpx, parseTcx, parsedToStream, pointsToStream, riegel, sliceGeometry,
  streamToGpx, streamToTcx, summarize, timerMs, transition, uuidv7, ImportError, type RecPoint,
} from '../src/index.js';
import { metersNorth, straightStream } from './helpers.js';

describe('geo', () => {
  it('haversine: 1 grado de latitud ≈ 111.19 km', () => {
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111_194.9, 0);
  });
  it('Madrid → Barcelona ≈ 505 km', () => {
    expect(haversine(40.4168, -3.7038, 41.3874, 2.1686) / 1000).toBeCloseTo(505, -1);
  });
  it('polilínea: ida y vuelta', () => {
    const pts: Array<[number, number]> = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
});

describe('ids', () => {
  it('uuidv7 válido, único y ordenable por tiempo', () => {
    const a = uuidv7(1000), b = uuidv7(2000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});

describe('métricas', () => {
  it('distancia, duración y ritmo de 5 km a 3.33 m/s', () => {
    const s = straightStream({ meters: 5000, speed: 10 / 3 });
    const st = computeStats(s, 'run');
    expect(st.distanceM).toBeCloseTo(5000, -1);
    expect(st.elapsedS).toBe(1500);
    expect(st.movingS).toBeGreaterThanOrEqual(1499);
    expect(st.avgSpeed).toBeCloseTo(3.333, 2);
    expect(formatPace(st.avgSpeed)).toBe('5:00 /km');
    expect(st.splits).toHaveLength(5);
    expect(st.splits[0]!.elapsedS).toBeCloseTo(300, 0);
  });

  it('no acumula distancia entre tramos (pausa)', () => {
    const a = straightStream({ meters: 1000, speed: 3 });
    const n = a.t.length;
    // Segundo tramo 500 m más al norte, 10 minutos después.
    const lat0 = metersNorth(a.lat[n - 1]!, 500);
    const b = straightStream({ meters: 1000, speed: 3, lat0 });
    const s = {
      t: [...a.t, ...b.t.map((t) => t + a.t[n - 1]! + 600_000)],
      lat: [...a.lat, ...b.lat], lng: [...a.lng, ...b.lng],
      seg: [...a.seg!, ...b.seg!.map(() => 1)],
    };
    const st = computeStats(s, 'run');
    expect(st.distanceM).toBeCloseTo(2000, -1);
    expect(st.timerS).toBeLessThan(st.elapsedS - 590);
    expect(st.movingS).toBeLessThan(700);
  });

  it('estar parado no suma tiempo en movimiento', () => {
    const s = straightStream({ meters: 1000, speed: 3 });
    const n = s.t.length;
    s.t.push(s.t[n - 1]! + 300_000);
    s.lat.push(s.lat[n - 1]! + 0.00001);
    s.lng.push(s.lng[n - 1]!);
    s.seg!.push(0);
    const st = computeStats(s, 'run');
    expect(st.elapsedS - st.movingS).toBeGreaterThanOrEqual(299);
  });

  it('desnivel: ignora ruido de ±1 m y suma subidas reales', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 1 : -1));
    expect(elevationGainLoss(noisy).gain).toBe(0);
    const climb = Array.from({ length: 101 }, (_, i) => 100 + i);
    expect(elevationGainLoss(climb).gain).toBeGreaterThanOrEqual(96);
  });

  it('mejor esfuerzo de 1 km dentro de 3 km con un km rápido', () => {
    const t: number[] = [], dist = new Float64Array(3001);
    let time = 0;
    for (let i = 0; i <= 3000; i++) {
      dist[i] = i;
      t.push(time);
      time += i >= 1000 && i < 2000 ? 250 : 400; // km central a 4 m/s
    }
    const be = bestEffort(t, dist, 1000)!;
    expect(be.elapsedS).toBeCloseTo(250, 0);
  });

  it('calorías: null sin peso (no se inventan datos)', () => {
    expect(estimateCalories('run', 1800, 5000, null)).toBeNull();
    expect(estimateCalories('run', 3600, 10000, 70)).toBeGreaterThan(600);
  });
});

describe('filtro GPS', () => {
  const base = { lat: 40, lng: -3, accuracy: 5, speed: 3 };
  it('rechaza precisión pobre, duplicados y tiempo retrocedido', () => {
    const f = new GpsFilter('run');
    expect(f.push({ ...base, time: 1000 }).accepted).toBe(true);
    expect(f.push({ ...base, time: 1000 }).accepted).toBe(false);
    expect(f.push({ ...base, lat: metersNorth(40, 3), time: 500 })).toEqual({ accepted: false, reason: 'time' });
    expect(f.push({ ...base, lat: metersNorth(40, 3), time: 2000, accuracy: 80 })).toEqual({ accepted: false, reason: 'accuracy' });
    expect(f.push({ ...base, lat: metersNorth(40, 3), time: 2000 }).accepted).toBe(true);
  });
  it('rechaza un salto imposible y reengancha si la nueva posición es coherente', () => {
    const f = new GpsFilter('run');
    f.push({ ...base, time: 0 });
    const far = metersNorth(40, 2000);
    expect(f.push({ ...base, lat: far, time: 1000 })).toEqual({ accepted: false, reason: 'jump' });
    const results = [];
    for (let i = 1; i <= 4; i++) results.push(f.push({ ...base, lat: metersNorth(far, i * 3), time: 1000 + i * 1000 }));
    expect(results).toContainEqual({ accepted: true, newSegment: true });
    expect(results.at(-1)).toEqual({ accepted: true, newSegment: false });
  });
  it('descarta el baile estando quieto', () => {
    const f = new GpsFilter('run');
    f.push({ ...base, speed: 0, time: 0 });
    expect(f.push({ ...base, lat: metersNorth(40, 1), speed: 0, time: 1000 })).toEqual({ accepted: false, reason: 'stationary' });
  });
});

describe('máquina de estados de grabación', () => {
  it('flujo completo, FINISH idempotente y reloj sin pausas', () => {
    let s = createSession('id', 'run', 0);
    s = transition(s, { type: 'START', at: 1000 });
    expect(s.status).toBe('recording');
    s = transition(s, { type: 'PAUSE', at: 61_000 });
    s = transition(s, { type: 'RESUME', at: 121_000 });
    expect(s.seg).toBe(1);
    s = transition(s, { type: 'FINISH', at: 181_000 });
    expect(s.status).toBe('finishing');
    expect(transition(s, { type: 'FINISH', at: 190_000 })).toBe(s);
    expect(timerMs(s, 999_999)).toBe(120_000);
    s = transition(s, { type: 'FAILED', at: 182_000, error: 'disk' });
    expect(s.status).toBe('error');
    s = transition(s, { type: 'RETRY', at: 183_000 });
    s = transition(s, { type: 'SAVED', at: 184_000 });
    expect(s.status).toBe('saved');
  });
  it('eventos inválidos no cambian el estado', () => {
    const s = createSession('id', 'run', 0);
    expect(transition(s, { type: 'PAUSE', at: 1 })).toBe(s);
    expect(transition(s, { type: 'FINISH', at: 1 })).toBe(s);
  });
  it('pointsToStream ordena y elimina puntos duplicados', () => {
    const p = (time: number, lat: number): RecPoint => ({ sessionId: 'x', time, lat, lng: -3, alt: null, accuracy: 5, seg: 0 });
    const s = pointsToStream([p(3000, 40.002), p(1000, 40), p(2000, 40.001), p(2000, 40.001)], 1000);
    expect(s.t).toEqual([0, 1000, 2000]);
    expect(StreamSchema.safeParse(s).success).toBe(true);
  });
  it('LiveMetrics coincide con computeStats', () => {
    const s = straightStream({ meters: 2000, speed: 4 });
    const pts: RecPoint[] = s.t.map((t, i) => ({ sessionId: 'x', time: t, lat: s.lat[i]!, lng: s.lng[i]!, alt: null, accuracy: 5, seg: 0 }));
    const live = LiveMetrics.fromPoints('run', pts);
    expect(live.distanceM).toBeCloseTo(computeStats(s, 'run').distanceM, 0);
    expect(live.splits).toHaveLength(2);
    expect(live.splits[0]!.timeMs).toBeCloseTo(250_000, -2);
  });
});

describe('archivos', () => {
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>Mañana &amp; sol</name><type>running</type><trkseg>
<trkpt lat="40.0" lon="-3.0"><ele>650</ele><time>2026-01-01T08:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="40.0001" lon="-3.0"><ele>651</ele><time>2026-01-01T08:00:05Z</time></trkpt>
<trkpt lat="40.0001" lon="-3.0"><ele>651</ele><time>2026-01-01T08:00:05Z</time></trkpt>
<trkpt lat="40.0002" lon="-3.0"><ele>652</ele><time>2026-01-01T08:00:10Z</time></trkpt>
</trkseg></trk></gpx>`;

  it('importa GPX con nombre, deporte, FC y elimina duplicados', () => {
    const p = parseGpx(gpx);
    expect(p.name).toBe('Mañana & sol');
    expect(p.sport).toBe('run');
    expect(p.timed).toBe(true);
    const { stream, dropped } = parsedToStream(p, 'run');
    expect(stream.t).toEqual([0, 5000, 10000]);
    expect(stream.hr?.[0]).toBe(120);
    expect(dropped).toBe(1);
  });

  it('rechaza DOCTYPE/ENTITY (XXE, billion laughs)', () => {
    expect(() => parseGpx('<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>')).toThrow(ImportError);
  });

  it('exportación GPX y TCX ida y vuelta', () => {
    const s = straightStream({ meters: 500, speed: 3, ele: (i) => 600 + i * 0.1, hr: 140 });
    const meta = { name: 'Prueba <1>', sport: 'run', startedAt: Date.parse('2026-05-01T07:00:00Z') };
    const back = parsedToStream(parseGpx(streamToGpx(s, meta)), 'run').stream;
    expect(back.t.length).toBe(s.t.length);
    expect(back.lat[10]).toBeCloseTo(s.lat[10]!, 6);
    expect(back.hr?.[5]).toBe(140);
    const tcx = parseTcx(streamToTcx(s, meta));
    expect(tcx.sport).toBe('run');
    expect(tcx.points.length).toBe(s.t.length);
  });
});

describe('segmentos', () => {
  it('detecta el intento y calcula el tiempo', () => {
    const s = straightStream({ meters: 3000, speed: 4 });
    const geom = sliceGeometry(s, 250, 500); // 1000 m entre 1000 y 2000 m
    const matches = matchSegment(s, geom);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.elapsedS).toBeCloseTo(250, 0);
  });
  it('no detecta segmentos en otra zona ni en sentido contrario', () => {
    const s = straightStream({ meters: 3000, speed: 4 });
    const geom = sliceGeometry(s, 250, 500);
    const reversed = { lat: geom.lat.slice().reverse(), lng: geom.lng.slice().reverse(), distanceM: geom.distanceM };
    expect(matchSegment(s, reversed)).toHaveLength(0);
    const elsewhere = straightStream({ meters: 3000, speed: 4, lat0: 41 });
    expect(matchSegment(elsewhere, geom)).toHaveLength(0);
  });
  it('marca esfuerzos imposibles como sospechosos', () => {
    expect(isSuspiciousEffort('run', 1000, 60)).toBe(true);
    expect(isSuspiciousEffort('run', 1000, 200)).toBe(false);
  });
});

describe('privacidad', () => {
  it('elimina puntos dentro de zonas privadas y abre tramo', () => {
    const s = straightStream({ meters: 2000, speed: 4 });
    const z = { lat: s.lat[0]!, lng: s.lng[0]!, radiusM: 300 };
    const p = applyPrivacyZones(s, [z]);
    expect(p.t.length).toBeLessThan(s.t.length);
    for (let i = 0; i < p.lat.length; i++) expect(haversine(p.lat[i]!, p.lng[i]!, z.lat, z.lng)).toBeGreaterThan(300);
    expect(cumulativeDistance(p).at(-1)).toBeLessThan(1710);
  });
});

describe('entrenamiento', () => {
  it('Riegel: 5 km en 25:00 → 10 km ≈ 52:06', () => {
    expect(formatDuration(riegel(1500, 5000, 10000))).toBe('52:07');
  });
  it('CTL crece con carga constante y ATL responde más rápido', () => {
    const from = Date.parse('2026-01-01');
    const loads = Array.from({ length: 30 }, (_, i) => ({ date: new Date(from + i * 86_400_000).toISOString().slice(0, 10), load: 50 }));
    const series = fitnessSeries(loads, from, from + 29 * 86_400_000);
    const last = series.at(-1)!;
    expect(last.atl).toBeGreaterThan(last.ctl);
    expect(last.ctl).toBeGreaterThan(20);
  });
  it('resumen semanal agrupa por semana ISO (lunes)', () => {
    const acts = [
      { startedAt: '2026-10-05T10:00:00', sport: 'run', distanceM: 5000, movingS: 1500, elevGainM: 20 },
      { startedAt: '2026-10-11T10:00:00', sport: 'run', distanceM: 10000, movingS: 3000, elevGainM: 50 },
      { startedAt: '2026-10-12T10:00:00', sport: 'ride', distanceM: 30000, movingS: 3600, elevGainM: 300 },
    ];
    const weeks = summarize(acts, 'week');
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.distanceM).toBe(15000);
  });
});

describe('planes', () => {
  it('gratuito sin funciones premium; Plus con todas', () => {
    expect(hasFeature(entitlementsFor('free'), 'training.load')).toBe(false);
    expect(hasFeature(entitlementsFor('plus'), 'training.load')).toBe(true);
  });
});

describe('esquemas', () => {
  it('actividad grabada sin recorrido es inválida', () => {
    const r = ActivityCreateSchema.safeParse({ id: uuidv7(), sport: 'run', name: 'x', startedAt: new Date().toISOString(), source: 'recorded', elapsedS: 10 });
    expect(r.success).toBe(false);
  });
  it('stream con longitudes inconsistentes es inválido', () => {
    expect(StreamSchema.safeParse({ t: [0, 1], lat: [1], lng: [1, 2] }).success).toBe(false);
  });
});
