/**
 * Detección de plataforma. Toda la UI y la lógica son comunes; solo los adaptadores de
 * `platform/` cambian según se ejecute en navegador, Android (Capacitor) o Windows (Tauri).
 */
export type Platform = 'web' | 'android' | 'windows';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean; getPlatform(): string };
    __TAURI_INTERNALS__?: unknown;
  }
}

function detect(): Platform {
  if (typeof window === 'undefined') return 'web';
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android') return 'android';
  if (window.__TAURI_INTERNALS__) return 'windows';
  return 'web';
}

export const platform: Platform = detect();
export const isNative = platform !== 'web';

/**
 * Base de la API. En web se usa el mismo origen (`/api`, proxy en desarrollo).
 * En Android/Windows es obligatoria una URL absoluta (VITE_API_URL).
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const isStandalonePwa = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
