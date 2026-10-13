import { createDb, migrateToLatest } from './db.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL no definido');
const db = createDb(url, 1);
try {
  const results = await migrateToLatest(db);
  if (!results.length) console.log('Base de datos al día.');
  for (const r of results) console.log(`${r.migrationName}: ${r.status}`);
} finally {
  await db.destroy();
}
