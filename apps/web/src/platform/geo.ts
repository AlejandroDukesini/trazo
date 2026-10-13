import type { RawFix } from '@trazo/core';
import { platform } from './index';
import { TrazoTracker } from './tracker';

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface GeoError {
  code: 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'native';
  message: string;
}

export interface GeoAdapter {
  kind: 'web' | 'native';
  /** ¿Puede seguir grabando con la pantalla apagada / la app en segundo plano? */
  backgroundCapable: boolean;
  permission(): Promise<GeoPermission>;
  request(): Promise<GeoPermission>;
  start(sessionId: string, onFixes: (fixes: RawFix[]) => void, onError: (e: GeoError) => void): Promise<void>;
  stop(): Promise<void>;
  /** ¿Sigue activo el servicio nativo para esta sesión? (recuperación tras cierre de la WebView) */
  isRunning?(sessionId: string): Promise<boolean>;
  /** Confirma que los puntos hasta `upTo` ya están en IndexedDB (el nativo puede borrarlos). */
  ack?(sessionId: string, upTo: number): Promise<void>;
}

/* ───────────── Web: watchPosition (solo primer plano) ───────────── */

function webAdapter(): GeoAdapter {
  let watchId: number | null = null;
  return {
    kind: 'web',
    backgroundCapable: false,
    async permission() {
      if (!('geolocation' in navigator)) return 'denied';
      try {
        const p = await navigator.permissions.query({ name: 'geolocation' });
        return p.state as GeoPermission;
      } catch {
        return 'unknown';
      }
    },
    request() {
      return new Promise<GeoPermission>((resolve) => {
        if (!('geolocation' in navigator)) return resolve('denied');
        navigator.geolocation.getCurrentPosition(
          () => resolve('granted'),
          (e) => resolve(e.code === e.PERMISSION_DENIED ? 'denied' : 'granted'),
          { enableHighAccuracy: true, timeout: 15_000 },
        );
      });
    },
    async start(_sessionId, onFixes, onError) {
      if (!('geolocation' in navigator)) {
        onError({ code: 'unsupported', message: 'Este navegador no ofrece geolocalización.' });
        return;
      }
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          onFixes([{ lat: c.latitude, lng: c.longitude, alt: c.altitude, accuracy: c.accuracy, speed: c.speed, time: pos.timestamp || Date.now() }]);
        },
        (e) => {
          if (e.code === e.PERMISSION_DENIED) onError({ code: 'denied', message: 'Permiso de ubicación denegado.' });
          else if (e.code === e.TIMEOUT) onError({ code: 'timeout', message: 'Sin señal GPS por ahora.' });
          else onError({ code: 'unavailable', message: 'Ubicación no disponible.' });
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    },
    async stop() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
  };
}

/* ───────────── Android: servicio en primer plano (plugin propio TrazoTracker) ───────────── */

function nativeAdapter(): GeoAdapter {
  let poll: ReturnType<typeof setInterval> | null = null;
  let current: string | null = null;
  let lastTime = 0;
  const drain = async (sessionId: string, onFixes: (f: RawFix[]) => void) => {
    // Los puntos ya están en SQLite nativo: aunque la WebView muera, no se pierden.
    // Se borran allí solo cuando la web confirma (ack) que los guardó en IndexedDB.
    const { fixes } = await TrazoTracker.drain({ sessionId, afterTime: lastTime });
    if (fixes.length) {
      lastTime = fixes[fixes.length - 1]!.time;
      onFixes(fixes);
    }
  };
  return {
    kind: 'native',
    backgroundCapable: true,
    async permission() {
      const p = await TrazoTracker.checkPermissions();
      return p.location === 'granted' ? 'granted' : p.location === 'denied' ? 'denied' : 'prompt';
    },
    async request() {
      const p = await TrazoTracker.requestPermissions();
      return p.location === 'granted' ? 'granted' : p.location === 'denied' ? 'denied' : 'prompt';
    },
    async start(sessionId, onFixes, onError) {
      try {
        const st = await TrazoTracker.status();
        if (!st.running || st.sessionId !== sessionId) {
          await TrazoTracker.start({ sessionId, intervalMs: 1000, notificationTitle: 'Trazo está grabando', notificationText: 'Tu actividad se registra aunque apagues la pantalla.' });
        }
        if (current !== sessionId) lastTime = 0;
        current = sessionId;
        await drain(sessionId, onFixes);
        if (poll) clearInterval(poll);
        poll = setInterval(() => {
          drain(sessionId, onFixes).catch((e) => onError({ code: 'native', message: String(e?.message ?? e) }));
        }, 1000);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        onError({ code: /permission|denied/i.test(msg) ? 'denied' : 'native', message: msg });
      }
    },
    async stop() {
      if (poll) clearInterval(poll);
      poll = null;
      if (current) current = null;
      await TrazoTracker.stop();
    },
    async ack(sessionId, upTo) {
      await TrazoTracker.ack({ sessionId, upTo });
    },
    async isRunning(sessionId) {
      const st = await TrazoTracker.status();
      return st.running && st.sessionId === sessionId;
    },
  };
}

export const geo: GeoAdapter = platform === 'android' ? nativeAdapter() : webAdapter();
