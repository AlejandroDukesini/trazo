import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'trazo-theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: ThemePref = readPref();

export function resolvedTheme(p: ThemePref = pref): 'light' | 'dark' {
  return p === 'system' ? (media?.matches ? 'dark' : 'light') : p;
}

function apply() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0d1015' : '#f4f5f7');
  listeners.forEach((l) => l());
}

export function setThemePref(p: ThemePref) {
  pref = p;
  try {
    if (p === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* almacenamiento no disponible */
  }
  apply();
}

export function initTheme() {
  apply();
  media?.addEventListener('change', () => { if (pref === 'system') apply(); });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => resolvedTheme(), () => 'light' as const);
  const preference = useSyncExternalStore(subscribe, () => pref, () => 'system' as const);
  return { theme, preference, setPreference: setThemePref };
}
