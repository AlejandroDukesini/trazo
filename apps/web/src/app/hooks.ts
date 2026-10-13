import { useEffect, useState, useSyncExternalStore } from 'react';
import { recorder } from '../data/recorder';
import { useSession } from '../data/session';
import type { Units } from '@trazo/core';

export function useOnline() {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('online', l);
      window.addEventListener('offline', l);
      return () => {
        window.removeEventListener('online', l);
        window.removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export const useRecorder = () => useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);

export function useMediaQuery(q: string) {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 900px)');

/** Reloj que se actualiza cada `ms` (solo mientras el componente está montado). */
export function useNow(ms = 1000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}

export function useUnits(): Units {
  return useSession().session?.user.units ?? 'metric';
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Trazo` : 'Trazo';
  }, [title]);
}
