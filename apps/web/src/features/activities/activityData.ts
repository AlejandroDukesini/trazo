import type { Stream } from '@trazo/core';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { userDb } from '../../data/db';
import type { LocalActivity } from '../../data/types';

/** Actividad para el detalle: copia local (todo vive en este dispositivo). */
export function useActivity(id: string) {
  const local = useLiveQuery(async () => (await userDb().activities.get(id)) ?? null, [id]);
  return { data: local ?? undefined, local, loading: local === undefined, error: null as unknown };
}

/** Recorrido de una actividad desde la caché local. */
export function useStream(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['stream', id],
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<Stream | null> => {
      const cached = await userDb().streams.get(id);
      return cached?.stream ?? null;
    },
  });
}

export type { LocalActivity };
