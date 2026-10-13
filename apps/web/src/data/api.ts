import { API_BASE, isNative, platform } from '../platform';
import { metaGet } from './db';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (l: Listener) => {
  unauthorizedListeners.add(l);
  return () => {
    unauthorizedListeners.delete(l);
  };
};

let tokenCache: string | null | undefined;
export async function getToken(): Promise<string | null> {
  if (!isNative) return null;
  if (tokenCache === undefined) tokenCache = (await metaGet<string>('token')) ?? null;
  return tokenCache;
}
export function setTokenCache(t: string | null) {
  tokenCache = t;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Devuelve la respuesta sin parsear (descargas). */
  raw?: boolean;
  /** No emitir el evento global de sesión caducada (p. ej. al comprobar sesión). */
  silent401?: boolean;
}

export function apiUrl(path: string) {
  return `${API_BASE}/api${path}`;
}

/** URL absoluta para recursos que el navegador carga directamente (imágenes). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('/api/') ? `${API_BASE}${path}` : path;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-trazo-client': platform };
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: opts.signal,
      credentials: isNative ? 'omit' : 'same-origin',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Sin conexión con el servidor.');
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401 && !opts.silent401) unauthorizedListeners.forEach((l) => l());
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? `Error ${res.status}`, d.details);
  }
  return data as T;
}

/** Descarga un archivo autenticado (exportaciones). */
export async function download(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? fallbackName;
  const { saveFile } = await import('../platform/files');
  await saveFile(name, blob);
}
