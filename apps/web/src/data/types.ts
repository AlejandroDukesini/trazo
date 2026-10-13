import type { BestEffort, Entitlements, LapStat, Split, Visibility } from '@trazo/core';

export interface UserCard {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Me extends UserCard {
  email: string;
  bio: string;
  location: string;
  isPrivate: boolean;
  units: 'metric' | 'imperial';
  defaultVisibility: Visibility;
  weightKg: number | null;
  hrMax: number | null;
  hrRest: number | null;
  ftp: number | null;
  role: 'user' | 'moderator' | 'admin';
  createdAt: string;
}

export interface SessionData {
  user: Me;
  entitlements: Entitlements;
}

export interface ActivityStatsJson {
  splits?: Split[];
  splitsImperial?: Split[];
  laps?: LapStat[];
  bestEfforts?: BestEffort[];
  pointCount?: number;
}

/** Forma de una actividad tal como la devuelve la API (y como se guarda en local). */
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
  version: number;
  changeSeq: number;
  updatedAt: string;
  deleted: boolean;
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
  photos: Array<{ id: string; url: string }>;
}

export type SyncState = 'pending' | 'synced' | 'conflict' | 'error';

export interface LocalActivity extends ActivityDTO {
  syncState: SyncState;
  /** Copia del servidor cuando hay conflicto de edición. */
  serverCopy?: ActivityDTO;
  lastError?: string;
  /** Datos de creación que solo existen en el cliente hasta sincronizar. */
  pauses?: Array<[number, number]>;
  device?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
