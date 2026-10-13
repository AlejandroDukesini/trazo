import { periodStart, type GoalPeriod } from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { userDb } from '../data/db';
import type { ActivityDTO, LocalActivity } from '../data/types';

export function useSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) cb.current(); }, { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

/** Actividades propias desde IndexedDB (disponibles sin conexión), filtradas por periodo. */
export function useLocalActivitiesSince(period: GoalPeriod) {
  const from = periodStart(period).toISOString();
  return useLiveQuery(() => userDb().activities.where('startedAt').aboveOrEqual(from).toArray(), [from]) ?? [];
}

export function useLocalActivity(id: string | undefined): LocalActivity | undefined | null {
  return useLiveQuery(async () => (id ? (await userDb().activities.get(id)) ?? null : null), [id]);
}

export type AnyActivity = ActivityDTO | LocalActivity;
