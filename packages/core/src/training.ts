/**
 * Análisis de entrenamiento. Todas las fórmulas están documentadas en docs/03-arquitectura.md.
 * Son indicadores orientativos para el deporte recreativo, **no** diagnósticos médicos.
 */

export interface HrZone {
  index: number;
  label: string;
  min: number;
  max: number;
}

/** Zonas por % de FC máxima (50-60-70-80-90-100 %). Configurables por el usuario. */
export const DEFAULT_HR_ZONE_PCTS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const ZONE_LABELS = ['Z1 · Recuperación', 'Z2 · Aeróbico', 'Z3 · Tempo', 'Z4 · Umbral', 'Z5 · Máximo'];

export function hrZones(hrMax: number, pcts: number[] = DEFAULT_HR_ZONE_PCTS): HrZone[] {
  const zones: HrZone[] = [];
  for (let i = 0; i < pcts.length - 1; i++) {
    zones.push({ index: i + 1, label: ZONE_LABELS[i] ?? `Z${i + 1}`, min: Math.round(hrMax * pcts[i]!), max: Math.round(hrMax * pcts[i + 1]!) });
  }
  return zones;
}

/** Segundos en cada zona (el tiempo de cada intervalo se asigna a la FC del punto final). */
export function timeInZones(t: number[], hr: Array<number | null>, zones: HrZone[], seg?: number[]): number[] {
  const out = zones.map(() => 0);
  for (let i = 1; i < t.length; i++) {
    if (seg && seg[i] !== seg[i - 1]) continue;
    const h = hr[i];
    if (h == null) continue;
    const dt = (t[i]! - t[i - 1]!) / 1000;
    if (dt <= 0 || dt > 30) continue;
    const z = zones.findIndex((zz, k) => h >= zz.min && (h < zz.max || k === zones.length - 1));
    if (z >= 0) out[z]! += dt;
  }
  return out;
}

/** TRIMP de Edwards: Σ minutos en zona × número de zona (1–5). */
export function edwardsTrimp(secondsInZones: number[]): number {
  return Math.round(secondsInZones.reduce((acc, s, i) => acc + (s / 60) * (i + 1), 0));
}

/** Carga por esfuerzo percibido (sRPE de Foster): minutos × RPE (1–10). */
export function srpeLoad(movingS: number, rpe: number): number {
  return Math.round((movingS / 60) * rpe);
}

export interface DailyLoad {
  /** YYYY-MM-DD */
  date: string;
  load: number;
}

export interface FitnessPoint {
  date: string;
  load: number;
  /** Forma crónica (media exponencial 42 d). */
  ctl: number;
  /** Fatiga aguda (media exponencial 7 d). */
  atl: number;
  /** Balance = CTL − ATL. */
  tsb: number;
}

const DAY = 86_400_000;
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Serie diaria CTL/ATL/TSB (modelo impulso-respuesta con medias exponenciales). */
export function fitnessSeries(loads: DailyLoad[], fromMs: number, toMs: number): FitnessPoint[] {
  const byDay = new Map<string, number>();
  for (const l of loads) byDay.set(l.date, (byDay.get(l.date) ?? 0) + l.load);
  const kCtl = 1 - Math.exp(-1 / 42), kAtl = 1 - Math.exp(-1 / 7);
  let ctl = 0, atl = 0;
  const out: FitnessPoint[] = [];
  for (let d = Math.floor(fromMs / DAY) * DAY; d <= toMs; d += DAY) {
    const date = isoDay(d);
    const load = byDay.get(date) ?? 0;
    const tsb = ctl - atl; // balance antes del entrenamiento del día
    ctl += (load - ctl) * kCtl;
    atl += (load - atl) * kAtl;
    out.push({ date, load, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round(tsb * 10) / 10 });
  }
  return out;
}

/** Predicción de Riegel: T2 = T1 · (D2/D1)^1.06. Es una ESTIMACIÓN. */
export function riegel(timeS: number, fromM: number, toM: number, exponent = 1.06): number {
  return timeS * (toM / fromM) ** exponent;
}

export type GoalMetric = 'distance' | 'duration' | 'elevation' | 'count';
export type GoalPeriod = 'week' | 'month' | 'year';

export interface ActivityLite {
  startedAt: string | number;
  sport: string;
  distanceM: number;
  movingS: number;
  elevGainM: number | null;
}

/** Inicio del periodo (semana ISO desde lunes) en la zona horaria local del entorno. */
export function periodStart(period: GoalPeriod, ref: Date = new Date()): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (period === 'month') d.setDate(1);
  else d.setMonth(0, 1);
  return d;
}

export function periodEnd(period: GoalPeriod, start: Date): Date {
  const d = new Date(start);
  if (period === 'week') d.setDate(d.getDate() + 7);
  else if (period === 'month') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

export function metricValue(a: ActivityLite, metric: GoalMetric): number {
  switch (metric) {
    case 'distance': return a.distanceM;
    case 'duration': return a.movingS;
    case 'elevation': return a.elevGainM ?? 0;
    case 'count': return 1;
  }
}

export function sumMetric(acts: ActivityLite[], metric: GoalMetric, sport: string | null, from: Date, to: Date): number {
  const f = from.getTime(), t = to.getTime();
  let sum = 0;
  for (const a of acts) {
    const ms = typeof a.startedAt === 'number' ? a.startedAt : Date.parse(a.startedAt);
    if (ms < f || ms >= t) continue;
    if (sport && a.sport !== sport) continue;
    sum += metricValue(a, metric);
  }
  return sum;
}

export interface PeriodSummary {
  key: string;
  start: Date;
  count: number;
  distanceM: number;
  movingS: number;
  elevGainM: number;
}

/** Agrupa actividades por semana/mes/año (para resúmenes y comparativas entre periodos). */
export function summarize(acts: ActivityLite[], period: GoalPeriod, sport: string | null = null): PeriodSummary[] {
  const map = new Map<string, PeriodSummary>();
  for (const a of acts) {
    if (sport && a.sport !== sport) continue;
    const start = periodStart(period, new Date(a.startedAt));
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    let s = map.get(key);
    if (!s) map.set(key, (s = { key, start, count: 0, distanceM: 0, movingS: 0, elevGainM: 0 }));
    s.count++;
    s.distanceM += a.distanceM;
    s.movingS += a.movingS;
    s.elevGainM += a.elevGainM ?? 0;
  }
  return [...map.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ───────────────────────── Planes de entrenamiento ───────────────────────── */

export interface PlanSession {
  day: number; // 0 = lunes
  kind: 'easy' | 'long' | 'tempo' | 'intervals' | 'rest' | 'cross';
  title: string;
  /** Minutos orientativos. */
  minutes: number;
  detail: string;
}

export interface TrainingPlanTemplate {
  key: string;
  title: string;
  sport: string;
  level: 'principiante' | 'intermedio';
  weeks: number;
  summary: string;
  build: (week: number) => PlanSession[];
}

const easy = (day: number, minutes: number): PlanSession => ({ day, kind: 'easy', title: 'Rodaje suave', minutes, detail: 'Ritmo conversacional (Z2). Debes poder hablar con frases completas.' });
const long = (day: number, minutes: number): PlanSession => ({ day, kind: 'long', title: 'Tirada larga', minutes, detail: 'Suave y constante. Prioriza completar el tiempo sobre el ritmo.' });

export const TRAINING_PLANS: TrainingPlanTemplate[] = [
  {
    key: 'run-5k-8w', title: 'Primer 5K', sport: 'run', level: 'principiante', weeks: 8,
    summary: '3 sesiones por semana combinando carrera y caminata hasta correr 30 minutos seguidos.',
    build: (w) => {
      const run = Math.min(30, 2 + w * 4);
      return [
        { day: 1, kind: 'intervals', title: 'Carrera/caminata', minutes: 30, detail: `Alterna ${Math.min(run, 10)} min corriendo suave y 2 min caminando hasta completar 30 min.` },
        easy(3, 25 + w),
        long(5, 30 + w * 2),
      ];
    },
  },
  {
    key: 'run-10k-10w', title: '10K con confianza', sport: 'run', level: 'intermedio', weeks: 10,
    summary: '4 sesiones semanales con un día de calidad y una tirada larga progresiva. Semana 4 y 8 de descarga.',
    build: (w) => {
      const deload = w === 4 || w === 8;
      const f = deload ? 0.7 : 1;
      return [
        easy(0, Math.round(35 * f)),
        w % 2
          ? { day: 2, kind: 'tempo', title: 'Tempo', minutes: Math.round((40 + w) * f), detail: `Calienta 10 min, ${Math.round((12 + w * 1.5) * f)} min a ritmo cómodamente duro (Z3-Z4), enfría.` }
          : { day: 2, kind: 'intervals', title: 'Series', minutes: Math.round(45 * f), detail: `Calienta 15 min, ${deload ? 4 : 5 + Math.floor(w / 3)} × 3 min fuerte (Z4) con 2 min suave, enfría.` },
        easy(4, Math.round(30 * f)),
        long(6, Math.round((55 + w * 5) * f)),
      ];
    },
  },
  {
    key: 'ride-base-6w', title: 'Base aeróbica en bici', sport: 'ride', level: 'principiante', weeks: 6,
    summary: 'Volumen progresivo en Z2 con un día de cadencia y una salida larga de fin de semana.',
    build: (w) => [
      { day: 1, kind: 'easy', title: 'Rodaje Z2', minutes: 45 + w * 5, detail: 'Pedaleo continuo y cómodo.' },
      { day: 3, kind: 'tempo', title: 'Cadencia', minutes: 50, detail: `${3 + Math.floor(w / 2)} × 5 min a cadencia alta (95-105 rpm) con 3 min suaves.` },
      long(5, 90 + w * 15),
    ],
  },
];

export function planWeek(template: TrainingPlanTemplate, startDate: Date, week: number) {
  const base = new Date(startDate);
  base.setDate(base.getDate() + (week - 1) * 7);
  return template.build(week).map((s) => {
    const date = new Date(base);
    date.setDate(date.getDate() + s.day);
    return { ...s, date };
  });
}
