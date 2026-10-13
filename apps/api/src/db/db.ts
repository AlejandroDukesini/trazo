import { Kysely, PostgresDialect } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import pg from 'pg';
import * as m0001 from './migrations/0001_init.js';
import type { DB } from './types.js';

// BIGINT (change_seq) como number: seguro hasta 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export function createDb(connectionString: string, max = 10): Kysely<DB> {
  const pool = new pg.Pool({ connectionString, max });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

const MIGRATIONS: Record<string, Migration> = {
  '0001_init': m0001,
};

export async function migrateToLatest(db: Kysely<DB>) {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return results ?? [];
}
