import type { Kysely } from 'kysely';
import type { Config } from './config.js';
import type { DB } from './db/types.js';
import type { Mailer } from './services/mailer.js';
import type { Storage } from './services/storage.js';

export interface AppContext {
  db: Kysely<DB>;
  config: Config;
  mailer: Mailer;
  storage: Storage;
  /** `fetch` inyectable (proveedores externos) para pruebas. */
  fetch: typeof fetch;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'user' | 'moderator' | 'admin';
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user: AuthUser | null;
    authVia: 'cookie' | 'bearer' | null;
  }
}
