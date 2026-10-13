import 'fake-indexeddb/auto';
import type { RawFix } from '@trazo/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Adaptador GPS simulado: la prueba entrega posiciones manualmente.
let emit: ((f: RawFix[]) => void) | null = null;
vi.mock('../src/platform/geo', () => ({
  geo: {
    kind: 'web',
    backgroundCapable: false,
    permission: async () => 'granted',
    request: async () => 'granted',
    start: async (_id: string, onFixes: (f: RawFix[]) => void) => { emit = onFixes; },
    stop: async () => { emit = null; },
  },
}));
vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));

const { Recorder } = await import('../src/data/recorder');
const { openUserDb, userDb } = await import('../src/data/db');

const me = { id: 'local', username: 'local', displayName: 'Yo', avatarUrl: null, units: 'metric' as const, defaultVisibility: 'private' as const, weightKg: null, hrMax: null, hrRest: null, ftp: null };
const M = 111_194.93;

function walk(from: { lat: number; t: number }, steps: number, metersPerStep: number) {
  const fixes: RawFix[] = [];
  for (let i = 1; i <= steps; i++) fixes.push({ lat: from.lat + (i * metersPerStep) / M, lng: -3.7, accuracy: 5, speed: metersPerStep, time: from.t + i * 1000 });
  return fixes;
}

beforeEach(async () => {
  openUserDb(`rec-${Math.random()}`);
  await userDb().open();
});

describe('grabador', () => {
  it('pausa/reanudación: la distancia recorrida en pausa no cuenta y finalizar es idempotente', async () => {
    const r = new Recorder();
    await r.warmUp();
    await r.start();
    const t0 = r.getSnapshot().session!.startedAt!;
    emit!(walk({ lat: 40, t: t0 }, 100, 4)); // 400 m
    await r.pause();
    emit!(walk({ lat: 40 + 400 / M, t: t0 + 100_000 }, 50, 10)); // 500 m en pausa: ignorados
    await r.resume();
    emit!(walk({ lat: 40 + 900 / M, t: t0 + 200_000 }, 50, 4)); // 200 m
    await Promise.all([r.finish(), r.finish()]);
    expect(r.getSnapshot().session!.status).toBe('finishing');
    const a = await r.save({ name: 'Prueba', description: '', visibility: 'public', rpe: 5 }, me);
    expect(a).not.toBeNull();
    expect(a!.distanceM).toBeGreaterThan(560);
    expect(a!.distanceM).toBeLessThan(620);
    expect(a!.source).toBe('recorded');
    // La sesión y sus puntos se limpian; la actividad queda guardada en local.
    expect(await userDb().recSessions.count()).toBe(0);
    expect(await userDb().recPoints.count()).toBe(0);
    expect(await userDb().activities.count()).toBe(1);
    const st = await userDb().streams.get(a!.id);
    expect(new Set(st!.stream.seg).size).toBe(2);
  });

  it('recupera una grabación interrumpida (cierre de la app) sin perder puntos', async () => {
    const r1 = new Recorder();
    await r1.warmUp();
    await r1.start();
    const t0 = r1.getSnapshot().session!.startedAt!;
    emit!(walk({ lat: 40, t: t0 }, 60, 5)); // 300 m
    await r1.pause(); // persiste puntos y estado
    // "Cierre": nueva instancia, mismo almacenamiento.
    const r2 = new Recorder();
    const s = await r2.recover();
    expect(s?.status).toBe('paused');
    expect(r2.getSnapshot().distanceM).toBeGreaterThan(290);
    expect(r2.getSnapshot().pointCount).toBe(60);
    await r2.resume();
    emit!(walk({ lat: 40 + 300 / M, t: t0 + 120_000 }, 20, 5));
    await r2.finish();
    const a = await r2.save({ name: 'Recuperada', description: '', visibility: 'private', rpe: null }, me);
    expect(a!.distanceM).toBeGreaterThan(380);
    expect(a!.distanceM).toBeLessThan(410);
  });

  it('descarta puntos imposibles (salto de 2 km en 1 s)', async () => {
    const r = new Recorder();
    await r.warmUp();
    await r.start();
    const t0 = r.getSnapshot().session!.startedAt!;
    const fixes = walk({ lat: 40, t: t0 }, 30, 3);
    fixes.splice(10, 0, { lat: 40 + 2000 / M, lng: -3.7, accuracy: 5, speed: 3, time: fixes[9]!.time + 500 });
    emit!(fixes);
    await r.finish();
    const a = await r.save({ name: 'x', description: '', visibility: 'public', rpe: null }, me);
    expect(a!.distanceM).toBeLessThan(100);
  });
});
