import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hasFeature, type Feature } from '@trazo/core';
import { isNative } from '../platform';
import { ApiError, api, onUnauthorized, setTokenCache } from './api';
import { deleteUserDb, getCachedSession, metaDel, metaSet, openUserDb, requestPersistentStorage, userDb } from './db';
import { sync } from './sync';
import type { Me, SessionData } from './types';

type Status = 'loading' | 'anon' | 'authed';

interface SessionCtx {
  status: Status;
  session: SessionData | null;
  /** true si la sesión viene de caché y aún no se ha validado con el servidor. */
  offline: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; username: string; displayName: string }) => Promise<void>;
  logout: (opts?: { force?: boolean }) => Promise<{ pending: number } | void>;
  refresh: () => Promise<void>;
  setMe: (me: Me) => void;
  can: (f: Feature) => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

async function persist(data: SessionData, token?: string) {
  await metaSet('session', data);
  if (token && isNative) {
    await metaSet('token', token);
    setTokenCache(token);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<SessionData | null>(null);
  const [offline, setOffline] = useState(false);

  const activate = useCallback((data: SessionData) => {
    openUserDb(data.user.id);
    setSession(data);
    setStatus('authed');
    sync.start();
    void requestPersistentStorage();
  }, []);

  const clear = useCallback(async () => {
    sync.stop();
    await metaDel('session');
    await metaDel('token');
    setTokenCache(null);
    setSession(null);
    setStatus('anon');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<SessionData>('/auth/session', { silent401: true });
      await persist(data);
      setOffline(false);
      if (status !== 'authed') activate(data);
      else setSession(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) await clear();
      else throw err;
    }
  }, [activate, clear, status]);

  // Arranque: sesión en caché → UI inmediata (también sin conexión); validación en segundo plano.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedSession();
      if (cached && !cancelled) {
        activate(cached);
        setOffline(true);
      }
      try {
        const data = await api<SessionData>('/auth/session', { silent401: true });
        if (cancelled) return;
        await persist(data);
        setOffline(false);
        activate(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) await clear();
        else if (!cached) setStatus('anon');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => onUnauthorized(() => void clear()), [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<SessionData & { token?: string }>('/auth/login', { method: 'POST', body: { email, password } });
    await persist({ user: r.user, entitlements: r.entitlements }, r.token);
    activate({ user: r.user, entitlements: r.entitlements });
    setOffline(false);
  }, [activate]);

  const register = useCallback(async (input: { email: string; password: string; username: string; displayName: string }) => {
    const r = await api<SessionData & { token?: string }>('/auth/register', { method: 'POST', body: input });
    await persist({ user: r.user, entitlements: r.entitlements }, r.token);
    activate({ user: r.user, entitlements: r.entitlements });
  }, [activate]);

  const logout = useCallback(async (opts: { force?: boolean } = {}) => {
    const userId = session?.user.id;
    if (userId) {
      const pending = await userDb().outbox.count();
      if (pending && !opts.force) return { pending };
    }
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* sin conexión: se cierra igualmente en local */
    }
    await clear();
    // Al cerrar sesión se eliminan los datos locales de la cuenta (privacidad en equipos compartidos).
    if (userId) await deleteUserDb(userId);
  }, [clear, session]);

  const value = useMemo<SessionCtx>(() => ({
    status, session, offline, login, register, logout, refresh,
    setMe: (me) => setSession((s) => {
      if (!s) return s;
      const next = { ...s, user: me };
      void metaSet('session', next);
      return next;
    }),
    can: (f) => hasFeature(session?.entitlements, f),
  }), [status, session, offline, login, register, logout, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession fuera de SessionProvider');
  return c;
}

/** Usuario autenticado (para pantallas dentro de la zona protegida). */
export function useMe(): Me {
  const s = useSession().session;
  if (!s) throw new Error('Sin sesión');
  return s.user;
}
