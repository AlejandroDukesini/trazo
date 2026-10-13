import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Almacenamiento de archivos. Implementación en disco local; en producción se sustituye por un
 * adaptador S3-compatible (R2/S3) con la misma interfaz.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Readable | null>;
  remove(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z]+\/[a-z0-9-]+\.(jpg|png|webp)$/;

export function diskStorage(root: string): Storage {
  const resolve = (key: string) => {
    if (!SAFE_KEY.test(key)) throw new Error('Clave de almacenamiento no válida');
    return path.join(root, key);
  };
  return {
    async put(key, data) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async get(key) {
      const p = resolve(key);
      try {
        await stat(p);
        return createReadStream(p);
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

/** Detecta el tipo real por cabecera (no se confía en la extensión ni en el Content-Type). */
export function sniffImage(buf: Buffer): { ext: 'jpg' | 'png' | 'webp'; mime: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
