/**
 * App totalmente local: no hay servidor ni API de red. Este módulo solo conserva
 * utilidades compatibles con el código existente.
 */

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
}

/**
 * Antes resolvía rutas de medios del servidor. Ahora las imágenes (avatar, fotos de
 * actividad, pantallazos importados) se guardan como data URLs, así que se devuelven tal cual.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  return path ?? null;
}
