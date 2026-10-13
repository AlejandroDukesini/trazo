/**
 * Matriz central de planes y funciones. Es la ÚNICA fuente de qué incluye cada plan.
 * El backend la usa para autorizar; el frontend solo para mostrar/ocultar y explicar.
 * Precios y periodos NO viven aquí: los define el proveedor de pagos (IDs de precio por entorno).
 */
export const FEATURES = {
  'activities.compare': 'Comparar dos actividades',
  'stats.periodCompare': 'Comparativa entre periodos',
  'stats.extendedHistory': 'Estadísticas históricas sin límite',
  'routes.autoRouting': 'Rutas automáticas por caminos',
  'routes.navigation': 'Navegación por ruta durante la actividad',
  'maps.offline': 'Mapas sin conexión',
  'segments.fullLeaderboard': 'Clasificaciones completas de segmentos',
  'goals.multiple': 'Objetivos ilimitados y mensuales/anuales',
  'training.zones': 'Zonas de frecuencia cardíaca y potencia',
  'training.load': 'Carga, forma y fatiga',
  'training.plans': 'Planes de entrenamiento',
  'reports.custom': 'Informes personalizados',
} as const;

export type Feature = keyof typeof FEATURES;
export type PlanKey = 'free' | 'plus';

export interface PlanDef {
  key: PlanKey;
  name: string;
  tagline: string;
  features: Feature[];
  limits: {
    activeGoals: number;
    /** Meses de historial en estadísticas agregadas (null = sin límite). */
    statsHistoryMonths: number | null;
    /** Posiciones visibles en clasificaciones de segmentos (además de la propia). */
    leaderboardRows: number;
    clubsOwned: number;
  };
}

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: 'free',
    name: 'Trazo',
    tagline: 'Todo lo esencial para registrar y compartir.',
    features: [],
    limits: { activeGoals: 1, statsHistoryMonths: 12, leaderboardRows: 10, clubsOwned: 1 },
  },
  plus: {
    key: 'plus',
    name: 'Trazo Plus',
    tagline: 'Análisis, planes y herramientas avanzadas.',
    features: Object.keys(FEATURES) as Feature[],
    limits: { activeGoals: 20, statsHistoryMonths: null, leaderboardRows: 100, clubsOwned: 10 },
  },
};

/** Funciones de Plus que aún no se pueden activar por motivos externos (licencias). */
export const UNAVAILABLE_FEATURES: Partial<Record<Feature, string>> = {
  'maps.offline': 'Requiere un proveedor de mapas con licencia para descarga offline.',
};

export interface Entitlements {
  plan: PlanKey;
  features: Feature[];
  limits: PlanDef['limits'];
  /** Fin del periodo pagado (ISO) si aplica. */
  activeUntil: string | null;
}

export function entitlementsFor(plan: PlanKey, activeUntil: string | null = null): Entitlements {
  const def = PLANS[plan];
  return { plan, features: def.features, limits: def.limits, activeUntil };
}

export function hasFeature(e: Pick<Entitlements, 'features'> | null | undefined, f: Feature): boolean {
  return !!e && e.features.includes(f);
}
