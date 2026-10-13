import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getProfile, openUserDb, requestPersistentStorage, setProfile } from './db';
import type { Me } from './types';

type Status = 'loading' | 'authed';

interface SessionData {
  user: Me;
}

interface SessionCtx {
  status: Status;
  session: SessionData | null;
  me: Me | null;
  setMe: (me: Me) => void;
  /** Todo es gratuito en la app local: no hay funciones de pago. */
  can: () => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

/** Perfil por defecto al abrir la app por primera vez en este dispositivo. */
function defaultProfile(): Me {
  return {
    id: 'local',
    username: 'local',
    displayName: 'Yo',
    avatarUrl: null,
    units: 'metric',
    defaultVisibility: 'private',
    weightKg: null,
    hrMax: null,
    hrRest: null,
    ftp: null,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMeState] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let profile = await getProfile();
      if (!profile) {
        profile = defaultProfile();
        await setProfile(profile);
      }
      if (cancelled) return;
      openUserDb();
      setMeState(profile);
      setStatus('authed');
      void requestPersistentStorage();
    })();
    return () => { cancelled = true; };
  }, []);

  const setMe = useCallback((next: Me) => {
    setMeState(next);
    void setProfile(next);
  }, []);

  const value = useMemo<SessionCtx>(() => ({
    status,
    session: me ? { user: me } : null,
    me,
    setMe,
    can: () => true,
  }), [status, me, setMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession fuera de SessionProvider');
  return c;
}

/** Perfil local (para pantallas dentro de la app). */
export function useMe(): Me {
  const m = useSession().me;
  if (!m) throw new Error('Perfil local no cargado');
  return m;
}
