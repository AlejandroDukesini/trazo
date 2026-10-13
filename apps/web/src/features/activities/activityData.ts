import { useQuery } from '@tanstack/react-query';
import type { Stream } from '@trazo/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { api } from '../../data/api';
import { userDb } from '../../data/db';
import type { ActivityDTO, LocalActivity } from '../../data/types';

/**
 * Actividad para el detalle: primero la copia local (propias, disponible sin conexión);
 * si no existe, la del servidor (actividades de otras personas).
 */
export function useActivity(id: string) {
  const local = useLiveQuery(async () => (await userDb().activities.get(id)) ?? null, [id]);
  const remote = useQuery({
    queryKey: ['activity', id],
    queryFn: () => api<ActivityDTO>(`/activities/${id}`),
    enabled: local === null || (local != null && local.syncState === 'synced'),
    staleTime: 15_000,
  });
  // Contadores sociales frescos del servidor, datos editables de la copia local.
  const data: (ActivityDTO & Partial<LocalActivity>) | undefined =
    local && remote.data ? { ...remote.data, ...local, reactionCount: remote.data.reactionCount, commentCount: remote.data.commentCount, viewerReacted: remote.data.viewerReacted, photos: remote.data.photos } : local ?? remote.data;
  return { data, local, loading: local === undefined || (local === null && remote.isPending), error: local === null ? remote.error : null };
}

/** Recorrido: caché local (propias) o servidor (con zonas privadas aplicadas para otros). */
export function useStream(id: string, enabled: boolean, cacheLocally: boolean) {
  return useQuery({
    queryKey: ['stream', id],
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<Stream | null> => {
      const cached = await userDb().streams.get(id);
      if (cached) return cached.stream;
      const s = await api<Stream>(`/activities/${id}/stream`);
      if (cacheLocally) await userDb().streams.put({ activityId: id, stream: s });
      return s;
    },
  });
}
