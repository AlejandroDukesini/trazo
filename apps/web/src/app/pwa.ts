import { useSyncExternalStore } from 'react';
import { isNative } from '../platform';

interface PwaState {
  updateReady: boolean;
  canInstall: boolean;
  offlineReady: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let state: PwaState = { updateReady: false, canInstall: false, offlineReady: false };
const listeners = new Set<() => void>();
const set = (p: Partial<PwaState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

let installEvent: BeforeInstallPromptEvent | null = null;
let applyUpdate: (() => Promise<void>) | null = null;

/** Registra el service worker (solo en web: en Android/Windows el contenido va empaquetado). */
export async function initPwa() {
  if (isNative || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    set({ canInstall: false });
  });
  const { Workbox } = await import('workbox-window');
  const wb = new Workbox('/sw.js');
  wb.addEventListener('waiting', () => {
    applyUpdate = async () => {
      wb.addEventListener('controlling', () => window.location.reload());
      wb.messageSkipWaiting();
    };
    set({ updateReady: true });
  });
  wb.addEventListener('activated', (e) => { if (!e.isUpdate) set({ offlineReady: true }); });
  await wb.register();
  // Comprueba actualizaciones cada hora mientras la app está abierta.
  setInterval(() => void wb.update(), 3600_000);
}

export async function promptInstall() {
  if (!installEvent) return false;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  set({ canInstall: false });
  return outcome === 'accepted';
}

export async function reloadForUpdate() {
  await applyUpdate?.();
}

export function usePwa() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
