import { useInfiniteQuery } from '@tanstack/react-query';
import { periodStart, type GoalPeriod } from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { api } from '../data/api';
import { userDb } from '../data/db';
import type { ActivityDTO, LocalActivity, Page } from '../data/types';

/** Lista paginada por cursor con carga al llegar al final. */
export function usePaged<T>(key: unknown[], path: string, enabled = true) {
  const q = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...q, items };
}

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
