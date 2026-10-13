import 'fake-indexeddb/auto';
import { uuidv7, type Stream } from '@trazo/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteActivityLocal, editActivity, resolveConflict, saveNewActivity } from '../src/data/activities';
import { openUserDb, userDb } from '../src/data/db';
import { sync } from '../src/data/sync';
import type { ActivityDTO, Me } from '../src/data/types';

/* ───────── Servidor simulado con la misma semántica que la API real ───────── */
interface ServerState {
  rows: Map<string, ActivityDTO>;
  seq: number;
  /** Fallos de red a inyectar: 'before' = la petición no llega; 'after' = el servidor procesa pero la respuesta se pierde. */
  failures: Array<'before' | 'after'>;
  requests: string[];
}
const server: ServerState = { rows: new Map(), seq: 0, failures: [], requests: [] };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function handle(method: string, url: string, body: Record<string, unknown> | null): Response {
  const path = url.replace(/^.*\/api/, '');
  let m: RegExpExecArray | null;
  if (method === 'GET' && (m = /^\/sync\/activities\?since=(\d+)/.exec(path))) {
    const since = Number(m[1]);
    const items = [...server.rows.values()].filter((r) => r.changeSeq > since).sort((a, b) => a.changeSeq - b.changeSeq);
    return json(200, { items, cursor: items.at(-1)?.changeSeq ?? since, more: false });
  }
  if ((m = /^\/activities\/([\w-]+)$/.exec(path))) {
    const id = m[1]!;
    const row = server.rows.get(id);
    if (method === 'PUT') {
      if (row) return json(200, row);
      const dto = { ...(body as unknown as ActivityDTO), owner: { id: 'u1', username: 'yo', displayName: 'Yo', avatarUrl: null }, version: 1, changeSeq: ++server.seq, deleted: false, reactionCount: 0, commentCount: 0, viewerReacted: false, photos: [], stats: {}, hasStream: !!body?.stream, polyline: null, updatedAt: new Date().toISOString() } as ActivityDTO;
      server.rows.set(id, dto);
      return json(201, dto);
    }
    if (method === 'PATCH') {
      if (!row || row.deleted) return json(404, { error: 'not_found', message: 'no' });
      if (body!.baseVersion !== row.version) return json(409, { error: 'version_conflict', message: 'Conflicto', details: { server: row } });
      const { baseVersion: _b, ...patch } = body!;
      const next = { ...row, ...patch, version: row.version + 1, changeSeq: ++server.seq } as ActivityDTO;
      server.rows.set(id, next);
      return json(200, next);
    }
    if (method === 'DELETE') {
      if (row) server.rows.set(id, { ...row, deleted: true, version: row.version + 1, changeSeq: ++server.seq });
      return json(200, { ok: true });
    }
  }
  return json(404, { error: 'not_found', message: path });
}

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  server.requests.push(`${method} ${url.replace(/^.*\/api/, '')}`);
  const f = server.failures.shift();
  if (f === 'before') throw new TypeError('Failed to fetch');
  const res = handle(method, url, init?.body ? JSON.parse(String(init.body)) : null);
  if (f === 'after') throw new TypeError('Failed to fetch');
  return res;
});
vi.stubGlobal('fetch', fetchMock);

const me: Me = {
  id: 'u1', username: 'yo', displayName: 'Yo', avatarUrl: null, email: 'yo@example.com', bio: '', location: '', isPrivate: false,
  units: 'metric', defaultVisibility: 'followers', weightKg: 70, hrMax: null, hrRest: null, ftp: null, role: 'user', createdAt: '',
};

function stream(n = 300): Stream {
  return { t: Array.from({ length: n }, (_, i) => i * 1000), lat: Array.from({ length: n }, (_, i) => 40 + i * 0.00003), lng: Array(n).fill(-3), seg: Array(n).fill(0) };
}

async function newActivity(name = 'Rodaje') {
  return saveNewActivity({ id: uuidv7(), sport: 'run', name, description: '', visibility: 'public', startedAt: new Date().toISOString(), source: 'recorded', elapsedS: 300, stream: stream() }, me);
}

/** Ejecuta la sincronización hasta vaciar la cola (ignorando la planificación de reintentos). */
async function drain() {
  for (let i = 0; i < 5; i++) {
    await userDb().outbox.toCollection().modify({ nextAttemptAt: 0 });
    await sync.run();
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(async () => {
  sync.stop();
  await sync.idle();
  server.rows.clear();
  server.seq = 0;
  server.failures = [];
  server.requests = [];
  openUserDb(`test-${Math.random()}`);
  await userDb().open();
});

describe('sincronización local-first', () => {
  it('guarda sin conexión y sincroniza al recuperarla', async () => {
    server.failures = ['before', 'before', 'before'];
    const a = await newActivity();
    await sync.run();
    expect((await userDb().activities.get(a.id))!.syncState).toBe('pending');
    expect(await userDb().outbox.count()).toBe(1);
    expect(sync.getSnapshot().state).toBe('offline');
    server.failures = [];
    await drain();
    expect((await userDb().activities.get(a.id))!.syncState).toBe('synced');
    expect(await userDb().outbox.count()).toBe(0);
    expect(server.rows.size).toBe(1);
  });

  it('respuesta perdida tras crear: el reintento no duplica', async () => {
    server.failures = ['after'];
    const a = await newActivity();
    await drain();
    expect(server.rows.size).toBe(1);
    expect(server.requests.filter((r) => r.startsWith('PUT')).length).toBeGreaterThanOrEqual(2);
    const local = await userDb().activities.get(a.id);
    expect(local!.syncState).toBe('synced');
    expect(local!.version).toBe(1);
  });

  it('editar antes de sincronizar envía los datos actuales en la creación (sin PATCH)', async () => {
    server.failures = Array(20).fill('before');
    const a = await newActivity('Antes');
    await sync.run();
    await editActivity(a.id, { name: 'Después' });
    await sync.idle();
    server.failures = [];
    await drain();
    expect(server.rows.get(a.id)!.name).toBe('Después');
    expect(server.requests.some((r) => r.startsWith('PATCH'))).toBe(false);
  });

  it('conflicto de edición explícito y resolución "conservar mis cambios"', async () => {
    const a = await newActivity('Original');
    await drain();
    // Otro dispositivo edita en el servidor.
    const row = server.rows.get(a.id)!;
    server.rows.set(a.id, { ...row, name: 'Desde el móvil', version: 2, changeSeq: ++server.seq });
    await editActivity(a.id, { name: 'Desde el portátil' });
    await drain();
    const local = await userDb().activities.get(a.id);
    expect(local!.syncState).toBe('conflict');
    expect(local!.serverCopy!.name).toBe('Desde el móvil');
    // Nada se ha sobrescrito en silencio.
    expect(server.rows.get(a.id)!.name).toBe('Desde el móvil');
    await resolveConflict(a.id, 'mine');
    await drain();
    expect(server.rows.get(a.id)!.name).toBe('Desde el portátil');
    expect(server.rows.get(a.id)!.version).toBe(3);
    expect((await userDb().activities.get(a.id))!.syncState).toBe('synced');
  });

  it('borrar algo que nunca llegó al servidor no genera peticiones', async () => {
    server.failures = Array(20).fill('before');
    const a = await newActivity();
    await sync.run();
    await deleteActivityLocal(a.id);
    await sync.idle();
    server.failures = [];
    server.requests = [];
    await drain();
    expect(server.requests.filter((r) => !r.startsWith('GET'))).toEqual([]);
    expect(await userDb().activities.count()).toBe(0);
  });

  it('pull: los borrados hechos en otro dispositivo se aplican en local', async () => {
    const a = await newActivity();
    await drain();
    const row = server.rows.get(a.id)!;
    server.rows.set(a.id, { ...row, deleted: true, version: 2, changeSeq: ++server.seq });
    await drain();
    expect(await userDb().activities.get(a.id)).toBeUndefined();
    expect(await userDb().streams.get(a.id)).toBeUndefined();
  });

  it('pull: descarga actividades creadas en otros dispositivos', async () => {
    const id = uuidv7();
    handle('PUT', `/api/activities/${id}`, { id, sport: 'ride', name: 'Desde Windows', startedAt: new Date().toISOString(), source: 'manual', elapsedS: 60 });
    await drain();
    expect((await userDb().activities.get(id))!.name).toBe('Desde Windows');
  });
});
