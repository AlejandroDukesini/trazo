/**
 * Registro de deportes. Añadir un deporte = añadir una entrada aquí; ninguna otra capa
 * necesita cambios (la UI, los filtros GPS y las métricas leen esta tabla).
 */
export interface SportDef {
  key: string;
  label: string;
  /** Nombre de icono lucide usado por la UI. */
  icon: string;
  /** Cómo se presenta la velocidad: ritmo (min/km) o velocidad (km/h). */
  display: 'pace' | 'speed';
  /** Velocidad por encima de la cual se considera "en movimiento" (m/s). */
  movingThreshold: number;
  /** Velocidad máxima plausible (m/s). Saltos más rápidos se descartan como error GPS. */
  maxSpeed: number;
  /** Velocidad máxima plausible sostenida en un segmento (antifraude, m/s). */
  maxSegmentSpeed: number;
  /** Tabla MET aproximada (Compendium of Physical Activities) por velocidad mínima en m/s. */
  met: ReadonlyArray<readonly [minSpeed: number, met: number]>;
  /** Grupo para segmentos y récords: deportes compatibles comparten tabla. */
  group: 'foot' | 'ride' | 'other';
  gps: boolean;
}

const SPORTS_LIST: SportDef[] = [
  {
    key: 'run', label: 'Carrera', icon: 'footprints', display: 'pace',
    movingThreshold: 0.6, maxSpeed: 12, maxSegmentSpeed: 7.5,
    met: [[0, 6], [2.2, 8.3], [2.7, 9.8], [3.0, 10.5], [3.4, 11.5], [3.8, 12.3], [4.5, 14.5], [5.4, 19]],
    group: 'foot', gps: true,
  },
  {
    key: 'trail_run', label: 'Trail', icon: 'mountain', display: 'pace',
    movingThreshold: 0.5, maxSpeed: 12, maxSegmentSpeed: 7.5,
    met: [[0, 7], [2.2, 9], [3.0, 11]], group: 'foot', gps: true,
  },
  {
    key: 'ride', label: 'Ciclismo', icon: 'bike', display: 'speed',
    movingThreshold: 1.0, maxSpeed: 35, maxSegmentSpeed: 25,
    met: [[0, 4], [4.5, 6.8], [5.4, 8], [6.2, 10], [7.1, 12], [8.9, 15.8]],
    group: 'ride', gps: true,
  },
  {
    key: 'mtb', label: 'BTT', icon: 'bike', display: 'speed',
    movingThreshold: 0.8, maxSpeed: 30, maxSegmentSpeed: 22,
    met: [[0, 8.5]], group: 'ride', gps: true,
  },
  {
    key: 'walk', label: 'Caminata', icon: 'person-standing', display: 'pace',
    movingThreshold: 0.3, maxSpeed: 6, maxSegmentSpeed: 3.5,
    met: [[0, 2.8], [1.1, 3.5], [1.6, 4.3], [1.8, 5]], group: 'foot', gps: true,
  },
  {
    key: 'hike', label: 'Senderismo', icon: 'tent-tree', display: 'pace',
    movingThreshold: 0.25, maxSpeed: 6, maxSegmentSpeed: 3.5,
    met: [[0, 6]], group: 'foot', gps: true,
  },
  {
    key: 'swim', label: 'Natación', icon: 'waves', display: 'pace',
    movingThreshold: 0.2, maxSpeed: 3, maxSegmentSpeed: 2.5,
    met: [[0, 7]], group: 'other', gps: false,
  },
  {
    key: 'workout', label: 'Entrenamiento', icon: 'dumbbell', display: 'speed',
    movingThreshold: 0, maxSpeed: 15, maxSegmentSpeed: 0,
    met: [[0, 5]], group: 'other', gps: false,
  },
];

export const SPORTS: Readonly<Record<string, SportDef>> = Object.freeze(
  Object.fromEntries(SPORTS_LIST.map((s) => [s.key, s])),
);
export const SPORT_KEYS = SPORTS_LIST.map((s) => s.key);
export const GPS_SPORT_KEYS = SPORTS_LIST.filter((s) => s.gps).map((s) => s.key);

export function getSport(key: string): SportDef {
  return SPORTS[key] ?? SPORTS.workout!;
}

export function metFor(sport: SportDef, speed: number): number {
  let met = sport.met[0]?.[1] ?? 5;
  for (const [min, value] of sport.met) if (speed >= min) met = value;
  return met;
}
