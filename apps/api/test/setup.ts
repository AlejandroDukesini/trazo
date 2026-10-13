import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uuidv7, type Stream } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, migrateToLatest } from '../src/db/db.js';
import { memoryMailer } from '../src/services/mailer.js';
import { diskStorage } from '../src/services/storage.js';

export const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_checks';
export const PRICE_MONTH = 'price_test_plus_month';

export async function createTestApp(fetchImpl: typeof fetch = globalThis.fetch) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL no definido (ver apps/api/.env.example)');
  const config = loadConfig(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_PLUS_MONTH: PRICE_MONTH,
    RATE_LIMIT_MAX: '10000',
    AUTH_RATE_LIMIT_MAX: '10000',
  });
  const db = createDb(url, 5);
  // Base de datos limpia en cada ejecución.
  await sql`drop schema public cascade; create schema public;`.execute(db);
  await migrateToLatest(db);
  const mailer = memoryMailer();
  const uploads = await mkdtemp(path.join(os.tmpdir(), 'trazo-test-'));
  const app = await buildApp({ db, config, mailer, storage: diskStorage(uploads), fetch: fetchImpl }, { logger: false });
  await app.ready();
  return { app, db, mailer };
}

export interface TestUser {
  id: string;
  token: string;
  username: string;
  headers: Record<string, string>;
}

let n = 0;
export async function registerUser(app: FastifyInstance, name?: string): Promise<TestUser> {
  const username = name ?? `user${++n}_${Date.now() % 100000}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'x-trazo-client': 'android' },
    payload: { email: `${username}@example.com`, password: 'contraseña-segura-1', username, displayName: username },
  });
  if (res.statusCode !== 201) throw new Error(`register ${res.statusCode}: ${res.body}`);
  const body = res.json();
  return { id: body.user.id, token: body.token, username, headers: { authorization: `Bearer ${body.token}` } };
}

const M_PER_DEG_LAT = 111_194.93;

export function straight(meters: number, speed: number, lat0 = 40.4168, lng0 = -3.7038): Stream {
  const nPts = Math.floor(meters / speed) + 1;
  const s: Stream = { t: [], lat: [], lng: [], seg: [], ele: [] };
  for (let i = 0; i < nPts; i++) {
    s.t.push(i * 1000);
    s.lat.push(lat0 + (i * speed) / M_PER_DEG_LAT);
    s.lng.push(lng0);
    s.seg!.push(0);
    s.ele!.push(600 + i * 0.05);
  }
  return s;
}

export function activityPayload(over: Record<string, unknown> = {}) {
  const stream = (over.stream as Stream) ?? straight(5000, 10 / 3);
  return {
    id: uuidv7(),
    sport: 'run',
    name: 'Rodaje matinal',
    visibility: 'public',
    startedAt: '2026-10-10T07:00:00.000Z',
    source: 'recorded',
    elapsedS: Math.round(stream.t[stream.t.length - 1]! / 1000),
    stream,
    ...over,
  };
}
