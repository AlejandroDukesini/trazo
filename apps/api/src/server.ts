import pino from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, migrateToLatest } from './db/db.js';
import { createMailer } from './services/mailer.js';
import { diskStorage } from './services/storage.js';

const config = loadConfig();
const log = pino({ level: config.NODE_ENV === 'production' ? 'info' : 'debug' });
const db = createDb(config.DATABASE_URL);

const results = await migrateToLatest(db);
for (const r of results) log.info(`migración ${r.migrationName}: ${r.status}`);

const app = await buildApp({
  db,
  config,
  mailer: createMailer(config, log),
  storage: diskStorage(config.UPLOAD_DIR),
  fetch: globalThis.fetch,
});

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
