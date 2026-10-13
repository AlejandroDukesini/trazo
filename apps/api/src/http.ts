import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, msg?: string, details?: unknown) => new HttpError(400, code, msg, details);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Necesitas iniciar sesión.');
export const forbidden = (msg = 'No tienes permiso para esta acción.') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'Recurso') => new HttpError(404, 'not_found', `${what} no encontrado.`);
export const conflict = (code: string, msg?: string, details?: unknown) => new HttpError(409, code, msg, details);
export const premiumRequired = (feature: string) =>
  new HttpError(402, 'premium_required', 'Esta función forma parte de Trazo Plus.', { feature });
export const unavailable = (code: string, msg: string) => new HttpError(503, code, msg);

export function parse<T extends ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('validation_error', 'Datos no válidos.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

/** Cursor opaco para paginación por (fecha, id). */
export function encodeCursor(date: Date | string, id: string): string {
  return Buffer.from(JSON.stringify([new Date(date).toISOString(), id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { date: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [date, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    if (Number.isNaN(Date.parse(date)) || typeof id !== 'string') return null;
    return { date, id };
  } catch {
    return null;
  }
}

export const PageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const IdParam = z.object({ id: z.uuid() });

export function idParam(req: FastifyRequest): string {
  return parse(IdParam, req.params).id;
}

export function sendFile(reply: FastifyReply, name: string, mime: string, body: string) {
  return reply
    .header('content-type', `${mime}; charset=utf-8`)
    .header('content-disposition', `attachment; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`)
    .send(body);
}
