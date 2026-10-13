import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const csv = z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  /** URL pública de la web (enlaces en correos, redirecciones de pago). */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Orígenes permitidos (web, Capacitor `https://localhost`, Tauri `http://tauri.localhost`). */
  CORS_ORIGINS: csv.default(['http://localhost:5173', 'https://localhost', 'http://tauri.localhost', 'https://tauri.localhost']),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default(false),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Correo saliente (recuperación de contraseña). Sin él, en desarrollo el enlace se registra en el log. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Trazo <no-reply@trazo.local>'),
  /** Proveedores externos opcionales. */
  ORS_API_KEY: z.string().optional(),
  PHOTON_URL: z.url().default('https://photon.komoot.io'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PLUS_MONTH: z.string().optional(),
  STRIPE_PRICE_PLUS_YEAR: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  /** Límite por minuto en login/registro/recuperación. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),
});

export type Config = z.infer<typeof EnvSchema> & { cookieSecure: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<string, string>> = {}): Config {
  const parsed = EnvSchema.safeParse({ ...env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${msg}`);
  }
  const c = parsed.data;
  return { ...c, cookieSecure: c.COOKIE_SECURE ?? c.NODE_ENV === 'production' };
}
