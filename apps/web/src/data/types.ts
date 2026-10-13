import type { BestEffort, LapStat, Split, Visibility } from '@trazo/core';

export interface UserCard {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Perfil local del único usuario. No hay cuenta ni servidor: todo vive en este dispositivo.
 * Conserva la forma de `UserCard` para encajar en `ActivityDTO.owner` sin tocar los componentes.
 */
export interface Me extends UserCard {
  units: 'metric' | 'imperial';
  defaultVisibility: Visibility;
  weightKg: number | null;
  hrMax: number | null;
  hrRest: number | null;
  ftp: number | null;
}

export interface ActivityStatsJson {
  splits?: Split[];
  splitsImperial?: Split[];
  laps?: LapStat[];
  bestEfforts?: BestEffort[];
  pointCount?: number;
}

/** Forma de una actividad tal como se guarda en local. */
export interface ActivityDTO {
  id: string;
  owner: UserCard;
  sport: string;
  name: string;
  description: string;
  visibility: Visibility;
  source: 'recorded' | 'imported' | 'manual';
  startedAt: string;
  timezone: string | null;
  elapsedS: number;
  timerS: number;
  movingS: number;
  distanceM: number;
  elevGainM: number | null;
  elevLossM: number | null;
  avgSpeed: number;
  maxSpeed: number;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  maxPower: number | null;
  avgCadence: number | null;
  calories: number | null;
  caloriesEstimated: boolean;
  rpe: number | null;
  trainingLoad: number | null;
  polyline: string | null;
  hasStream: boolean;
  stats: ActivityStatsJson;
  lapMarks: number[];
  updatedAt: string;
  photos: Array<{ id: string; url: string }>;
}

export interface LocalActivity extends ActivityDTO {
  pauses?: Array<[number, number]>;
  device?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
