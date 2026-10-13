import { registerPlugin, type PermissionState } from '@capacitor/core';
import type { RawFix } from '@trazo/core';

/** Contrato del plugin nativo Android (android/app/src/main/java/app/trazo/tracker). */
export interface TrazoTrackerPlugin {
  start(opts: { sessionId: string; intervalMs: number; notificationTitle: string; notificationText: string }): Promise<void>;
  stop(): Promise<void>;
  /** Puntos persistidos de la sesión posteriores a `afterTime` (no los borra). */
  drain(opts: { sessionId: string; afterTime?: number }): Promise<{ fixes: RawFix[] }>;
  /** Confirma que la web ya guardó los puntos hasta `upTo` (epoch ms): el nativo los borra. */
  ack(opts: { sessionId: string; upTo: number }): Promise<void>;
  status(): Promise<{ running: boolean; sessionId: string | null }>;
  checkPermissions(): Promise<{ location: PermissionState; notifications: PermissionState }>;
  requestPermissions(): Promise<{ location: PermissionState; notifications: PermissionState }>;
  /** Abre los ajustes de optimización de batería de la app. */
  openBatterySettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ value: boolean }>;
}

export const TrazoTracker = registerPlugin<TrazoTrackerPlugin>('TrazoTracker');
