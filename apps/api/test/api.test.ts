import { decodePolyline, haversine, uuidv7 } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../src/db/types.js';
import type { memoryMailer } from '../src/services/mailer.js';
import { PRICE_MONTH, WEBHOOK_SECRET, activityPayload, createTestApp, registerUser, straight, type TestUser } from './setup.js';

let app: FastifyInstance;
let db: Kysely<DB>;
let mailer: ReturnType<typeof memoryMailer>;

const photonResponse = { features: [{ geometry: { coordinates: [-3.7038, 40.4168] }, properties: { name: 'Puerta del Sol', city: 'Madrid', country: 'España' } }] };
const fakeFetch = (async (input: string | URL) => {
  if (String(input).includes('/api/')) return new Response(JSON.stringify(photonResponse), { status: 200 });
  return new Response('not found', { status: 404 });
}) as typeof fetch;

beforeAll(async () => {
  ({ app, db, mailer } = await createTestApp(fakeFetch));
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const put = (u: TestUser, body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/activities/${body.id}`, headers: u.headers, payload: body });

describe('autenticación', () => {
  it('registro, sesión con token, logout invalida la sesión', async () => {
    const u = await registerUser(app);
    const s = await app.inject({ method: 'GET', url: '/api/auth/session', headers: u.headers });
    expect(s.statusCode).toBe(200);
    expect(s.json().user.username).toBe(u.username);
    expect(s.json().entitlements.plan).toBe('free');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: u.headers });
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: u.headers })).statusCode).toBe(401);
  });

  it('rechaza correo duplicado y credenciales incorrectas', async () => {
    const u = await registerUser(app);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `${u.username}@example.com`, password: 'otra-contraseña-1', username: `${u.username}x`, displayName: 'X' } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${u.username}@example.com`, password: 'incorrecta-123' } });
    expect(bad.statusCode).toBe(401);
  });

  it('web: cookie HttpOnly y protección CSRF por origen', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'web@example.com', password: 'contraseña-segura-1', username: 'webuser', displayName: 'Web' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().token).toBeUndefined();
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/trazo_session=.+HttpOnly/i);
    const cookie = setCookie.split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(200);
    const noOrigin = await app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie }, payload: { bio: 'hola' } });
    expect(noOrigin.statusCode).toBe(403);
    const evil = await app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie, origin: 'https://evil.example' }, payload: { bio: 'hola' } });
    expect(evil.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie, origin: 'http://localhost:5173' }, payload: { bio: 'hola' } });
    expect(ok.statusCode).toBe(200);
  });

  it('recuperación de contraseña con token de un solo uso', async () => {
    const u = await registerUser(app);
    const email = `${u.username}@example.com`;
    const r = await app.inject({ method: 'POST', url: '/api/auth/password-reset/request', payload: { email } });
    expect(r.statusCode).toBe(202);
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/password-reset/request', payload: { email: 'nadie@example.com' } });
    expect(unknown.statusCode).toBe(202);
    const mail = mailer.sent.find((m) => m.to === email)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    const c1 = await app.inject({ method: 'POST', url: '/api/auth/password-reset/confirm', payload: { token, password: 'nueva-contraseña-2' } });
    expect(c1.statusCode).toBe(200);
    const c2 = await app.inject({ method: 'POST', url: '/api/auth/password-reset/confirm', payload: { token, password: 'otra-contraseña-3' } });
    expect(c2.statusCode).toBe(400);
    // Las sesiones anteriores quedan revocadas.
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: u.headers })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-trazo-client': 'windows' }, payload: { email, password: 'nueva-contraseña-2' } });
    expect(login.statusCode).toBe(200);
  });
});

describe('actividades', () => {
  it('crea con métricas calculadas en servidor e ignora métricas del cliente', async () => {
    const u = await registerUser(app);
    const body = activityPayload({ distanceM: 999_999 });
    const res = await put(u, body);
    expect(res.statusCode).toBe(201);
    const a = res.json();
    expect(a.distanceM).toBeGreaterThan(4950);
    expect(a.distanceM).toBeLessThan(5050);
    expect(a.movingS).toBeGreaterThan(1450);
    expect(a.stats.splits).toHaveLength(5);
    expect(a.version).toBe(1);
  });

  it('reintento con el mismo id no duplica; otro usuario no puede reutilizarlo', async () => {
    const u = await registerUser(app);
    const body = activityPayload();
    expect((await put(u, body)).statusCode).toBe(201);
    const again = await put(u, body);
    expect(again.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/activities', headers: u.headers });
    expect(list.json().items).toHaveLength(1);
    const other = await registerUser(app);
    expect((await put(other, body)).statusCode).toBe(409);
  });

  it('carrera de creaciones simultáneas con el mismo id', async () => {
    const u = await registerUser(app);
    const body = activityPayload();
    const results = await Promise.all([put(u, body), put(u, body), put(u, body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    const count = await db.selectFrom('activities').select(db.fn.countAll<number>().as('n')).where('id', '=', body.id as string).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it('edición con control de versión y conflicto explícito', async () => {
    const u = await registerUser(app);
    const body = activityPayload();
    await put(u, body);
    const p1 = await app.inject({ method: 'PATCH', url: `/api/activities/${body.id}`, headers: u.headers, payload: { baseVersion: 1, name: 'Tirada larga' } });
    expect(p1.statusCode).toBe(200);
    expect(p1.json().version).toBe(2);
    const stale = await app.inject({ method: 'PATCH', url: `/api/activities/${body.id}`, headers: u.headers, payload: { baseVersion: 1, name: 'Copia antigua' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().details.server.name).toBe('Tirada larga');
  });

  it('borrado idempotente con tombstone en la sincronización', async () => {
    const u = await registerUser(app);
    const body = activityPayload();
    await put(u, body);
    const s0 = (await app.inject({ method: 'GET', url: '/api/sync/activities?since=0', headers: u.headers })).json();
    expect(s0.items).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/activities/${body.id}`, headers: u.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/activities/${body.id}`, headers: u.headers })).statusCode).toBe(200);
    const s1 = (await app.inject({ method: 'GET', url: `/api/sync/activities?since=${s0.cursor}`, headers: u.headers })).json();
    expect(s1.items).toHaveLength(1);
    expect(s1.items[0].deleted).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${body.id}`, headers: u.headers })).statusCode).toBe(404);
  });

  it('filtros y paginación del historial', async () => {
    const u = await registerUser(app);
    for (let i = 0; i < 5; i++) {
      await put(u, activityPayload({ name: i % 2 ? 'Bici' : 'Carrera', sport: i % 2 ? 'ride' : 'run', startedAt: `2026-09-0${i + 1}T08:00:00.000Z`, stream: straight(1000 * (i + 1), i % 2 ? 8 : 3) }));
    }
    const rides = (await app.inject({ method: 'GET', url: '/api/activities?sport=ride', headers: u.headers })).json();
    expect(rides.items).toHaveLength(2);
    const long = (await app.inject({ method: 'GET', url: '/api/activities?minDistance=3500', headers: u.headers })).json();
    expect(long.items).toHaveLength(2);
    const p1 = (await app.inject({ method: 'GET', url: '/api/activities?limit=2', headers: u.headers })).json();
    expect(p1.items).toHaveLength(2);
    const p2 = (await app.inject({ method: 'GET', url: `/api/activities?limit=2&cursor=${p1.nextCursor}`, headers: u.headers })).json();
    expect(p2.items[0].id).not.toBe(p1.items[1].id);
    expect(new Date(p2.items[0].startedAt) < new Date(p1.items[1].startedAt)).toBe(true);
  });

  it('exporta GPX y TCX solo para el propietario', async () => {
    const u = await registerUser(app);
    const body = activityPayload({ visibility: 'public' });
    await put(u, body);
    const gpx = await app.inject({ method: 'GET', url: `/api/activities/${body.id}/export?format=gpx`, headers: u.headers });
    expect(gpx.statusCode).toBe(200);
    expect(gpx.body).toContain('<trkpt');
    const tcx = await app.inject({ method: 'GET', url: `/api/activities/${body.id}/export?format=tcx`, headers: u.headers });
    expect(tcx.body).toContain('<Trackpoint>');
    const other = await registerUser(app);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${body.id}/export`, headers: other.headers })).statusCode).toBe(403);
  });

  it('actividad manual sin recorrido', async () => {
    const u = await registerUser(app);
    const res = await put(u, { id: uuidv7(), sport: 'workout', name: 'Gimnasio', startedAt: '2026-10-01T18:00:00Z', source: 'manual', elapsedS: 3600, rpe: 6 });
    expect(res.statusCode).toBe(201);
    expect(res.json().trainingLoad).toBe(360);
    expect(res.json().hasStream).toBe(false);
  });

  it('valida el cuerpo (stream incoherente)', async () => {
    const u = await registerUser(app);
    const bad = activityPayload({ stream: { t: [0, 1000], lat: [40], lng: [-3, -3] } });
    expect((await put(u, bad)).statusCode).toBe(400);
  });
});

describe('privacidad y permisos', () => {
  it('privada: invisible para otros; seguidores: solo seguidores aceptados', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const priv = activityPayload({ visibility: 'private' });
    const fol = activityPayload({ visibility: 'followers' });
    await put(owner, priv);
    await put(owner, fol);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${priv.id}`, headers: stranger.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${priv.id}/stream`, headers: stranger.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${fol.id}`, headers: stranger.headers })).statusCode).toBe(404);
    await app.inject({ method: 'POST', url: `/api/users/${owner.id}/follow`, headers: stranger.headers });
    expect((await app.inject({ method: 'GET', url: `/api/activities/${fol.id}`, headers: stranger.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${priv.id}`, headers: stranger.headers })).statusCode).toBe(404);
    // Sin sesión, nada privado.
    expect((await app.inject({ method: 'GET', url: `/api/activities/${fol.id}` })).statusCode).toBe(404);
  });

  it('zonas privadas: los demás no reciben puntos dentro de la zona', async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    const stream = straight(3000, 3);
    const z = { lat: stream.lat[0]!, lng: stream.lng[0]!, radiusM: 500 };
    const zr = await app.inject({ method: 'POST', url: '/api/me/privacy-zones', headers: owner.headers, payload: z });
    expect(zr.statusCode).toBe(201);
    const body = activityPayload({ stream, visibility: 'public' });
    await put(owner, body);
    const theirs = (await app.inject({ method: 'GET', url: `/api/activities/${body.id}/stream`, headers: viewer.headers })).json();
    for (let i = 0; i < theirs.lat.length; i++) expect(haversine(theirs.lat[i], theirs.lng[i], z.lat, z.lng)).toBeGreaterThan(500);
    const mine = (await app.inject({ method: 'GET', url: `/api/activities/${body.id}/stream`, headers: owner.headers })).json();
    expect(mine.lat.length).toBe(stream.lat.length);
    const dto = (await app.inject({ method: 'GET', url: `/api/activities/${body.id}`, headers: viewer.headers })).json();
    for (const [la, ln] of decodePolyline(dto.polyline)) expect(haversine(la, ln, z.lat, z.lng)).toBeGreaterThan(490);
  });

  it('bloqueo: oculta el feed, impide seguir y reaccionar', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await app.inject({ method: 'POST', url: `/api/users/${a.id}/follow`, headers: b.headers });
    const act = activityPayload({ visibility: 'public' });
    await put(a, act);
    expect((await app.inject({ method: 'GET', url: '/api/feed', headers: b.headers })).json().items.map((i: { id: string }) => i.id)).toContain(act.id);
    await app.inject({ method: 'POST', url: `/api/users/${b.id}/block`, headers: a.headers });
    expect((await app.inject({ method: 'GET', url: '/api/feed', headers: b.headers })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: `/api/users/${a.id}/follow`, headers: b.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/activities/${act.id}/reaction`, headers: b.headers })).statusCode).toBe(404);
  });

  it('cuenta privada: seguir crea solicitud que hay que aceptar', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await app.inject({ method: 'PATCH', url: '/api/me', headers: a.headers, payload: { isPrivate: true } });
    const pub = activityPayload({ visibility: 'public' });
    await put(a, pub);
    expect((await app.inject({ method: 'GET', url: `/api/activities/${pub.id}`, headers: b.headers })).statusCode).toBe(404);
    const f = await app.inject({ method: 'POST', url: `/api/users/${a.id}/follow`, headers: b.headers });
    expect(f.json().status).toBe('pending');
    const reqs = (await app.inject({ method: 'GET', url: '/api/me/follow-requests', headers: a.headers })).json();
    expect(reqs[0].id).toBe(b.id);
    await app.inject({ method: 'POST', url: `/api/me/follow-requests/${b.id}/accept`, headers: a.headers });
    expect((await app.inject({ method: 'GET', url: `/api/activities/${pub.id}`, headers: b.headers })).statusCode).toBe(200);
  });

  it('nadie puede editar ni borrar actividades ajenas', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const act = activityPayload({ visibility: 'public' });
    await put(a, act);
    expect((await app.inject({ method: 'PATCH', url: `/api/activities/${act.id}`, headers: b.headers, payload: { baseVersion: 1, name: 'hack' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/activities/${act.id}`, headers: b.headers })).statusCode).toBe(403);
  });
});

describe('social', () => {
  it('feed, reacciones, comentarios y notificaciones', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await app.inject({ method: 'POST', url: `/api/users/${a.id}/follow`, headers: b.headers });
    const act = activityPayload({ visibility: 'followers' });
    await put(a, act);
    const feed = (await app.inject({ method: 'GET', url: '/api/feed', headers: b.headers })).json();
    expect(feed.items[0].id).toBe(act.id);
    await app.inject({ method: 'PUT', url: `/api/activities/${act.id}/reaction`, headers: b.headers });
    await app.inject({ method: 'PUT', url: `/api/activities/${act.id}/reaction`, headers: b.headers });
    const c = await app.inject({ method: 'POST', url: `/api/activities/${act.id}/comments`, headers: b.headers, payload: { body: '¡Buen ritmo!' } });
    expect(c.statusCode).toBe(201);
    const detail = (await app.inject({ method: 'GET', url: `/api/activities/${act.id}`, headers: b.headers })).json();
    expect(detail.reactionCount).toBe(1);
    expect(detail.commentCount).toBe(1);
    expect(detail.viewerReacted).toBe(true);
    const notes = (await app.inject({ method: 'GET', url: '/api/notifications', headers: a.headers })).json();
    expect(notes.items.map((n: { kind: string }) => n.kind).sort()).toEqual(['comment', 'follow', 'reaction']);
    expect(notes.unread).toBe(3);
    await app.inject({ method: 'POST', url: '/api/notifications/read', headers: a.headers, payload: {} });
    expect((await app.inject({ method: 'GET', url: '/api/notifications', headers: a.headers })).json().unread).toBe(0);
    // El autor del comentario y el dueño de la actividad pueden borrarlo; un tercero no.
    const third = await registerUser(app);
    expect((await app.inject({ method: 'DELETE', url: `/api/comments/${c.json().id}`, headers: third.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/comments/${c.json().id}`, headers: a.headers })).statusCode).toBe(200);
  });

  it('clubes privados, invitaciones y retos con clasificación', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const outsider = await registerUser(app);
    const club = await app.inject({ method: 'POST', url: '/api/clubs', headers: owner.headers, payload: { name: 'Club Amanecer', visibility: 'private' } });
    expect(club.statusCode).toBe(201);
    const clubId = club.json().id;
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${clubId}`, headers: outsider.headers })).statusCode).toBe(404);
    await app.inject({ method: 'POST', url: `/api/clubs/${clubId}/invite`, headers: owner.headers, payload: { userId: member.id } });
    expect((await app.inject({ method: 'POST', url: `/api/clubs/${clubId}/join`, headers: member.headers })).json().status).toBe('active');
    // Un plan gratuito permite 1 club propio.
    expect((await app.inject({ method: 'POST', url: '/api/clubs', headers: owner.headers, payload: { name: 'Otro club' } })).statusCode).toBe(400);
    const ch = await app.inject({
      method: 'POST', url: '/api/challenges', headers: owner.headers,
      payload: { title: '50 km en octubre', metric: 'distance', target: 50_000, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', clubId },
    });
    expect(ch.statusCode).toBe(201);
    const chId = ch.json().id;
    expect((await app.inject({ method: 'POST', url: `/api/challenges/${chId}/join`, headers: outsider.headers })).statusCode).toBe(403);
    await app.inject({ method: 'POST', url: `/api/challenges/${chId}/join`, headers: member.headers });
    await put(member, activityPayload({ startedAt: '2026-10-05T07:00:00Z', stream: straight(10_000, 3) }));
    await put(member, activityPayload({ startedAt: '2026-09-05T07:00:00Z', stream: straight(10_000, 3) })); // fuera de la ventana
    const detail = (await app.inject({ method: 'GET', url: `/api/challenges/${chId}`, headers: owner.headers })).json();
    expect(detail.leaderboard[0].user.id).toBe(member.id);
    expect(detail.leaderboard[0].value).toBeGreaterThan(9900);
    expect(detail.leaderboard[0].value).toBeLessThan(10100);
  });
});

describe('segmentos', () => {
  it('crea segmento, detecta intentos, clasifica y marca intentos imposibles', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const first = activityPayload({ stream: straight(3000, 3, 41.0, 2.0) });
    await put(a, first);
    const seg = await app.inject({ method: 'POST', url: '/api/segments', headers: a.headers, payload: { activityId: first.id, startIndex: 300, endIndex: 700, name: 'Recta del parque' } });
    expect(seg.statusCode).toBe(201);
    expect(seg.json().efforts).toBe(1);
    const segId = seg.json().id;
    // b lo hace más rápido; un "corredor en coche" queda marcado.
    const fast = activityPayload({ stream: straight(3000, 4, 41.0, 2.0) });
    await put(b, fast);
    const car = await registerUser(app);
    await put(car, activityPayload({ stream: straight(3000, 11, 41.0, 2.0) }));
    const board = (await app.inject({ method: 'GET', url: `/api/segments/${segId}/leaderboard`, headers: a.headers })).json();
    expect(board.entries.map((e: { user: { id: string } }) => e.user.id)).toEqual([b.id, a.id]);
    expect(board.entries[0].elapsedS).toBeCloseTo(300, -1);
    const efforts = (await app.inject({ method: 'GET', url: `/api/activities/${fast.id}/efforts`, headers: b.headers })).json();
    expect(efforts[0].isPersonalBest).toBe(true);
  });
});

describe('suscripciones', () => {
  const stripe = new Stripe('sk_test_unused');
  const signed = (payload: string) => stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const subEvent = (id: string, userId: string, status: string) =>
    JSON.stringify({
      id, object: 'event', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test_1', object: 'subscription', customer: 'cus_test_1', status, cancel_at_period_end: false, metadata: { userId }, items: { data: [{ price: { id: PRICE_MONTH }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } } },
    });

  it('premium solo tras un webhook firmado; idempotente; cancelación retira acceso', async () => {
    const u = await registerUser(app);
    expect((await app.inject({ method: 'GET', url: '/api/training/load', headers: u.headers })).statusCode).toBe(402);
    // Firma falsa → rechazado.
    const forged = subEvent('evt_forged', u.id, 'active');
    const bad = await app.inject({ method: 'POST', url: '/api/billing/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, payload: forged });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/training/load', headers: u.headers })).statusCode).toBe(402);
    const ev = subEvent('evt_1', u.id, 'active');
    const ok = await app.inject({ method: 'POST', url: '/api/billing/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': signed(ev) }, payload: ev });
    expect(ok.statusCode).toBe(200);
    const dup = await app.inject({ method: 'POST', url: '/api/billing/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': signed(ev) }, payload: ev });
    expect(dup.json().duplicate).toBe(true);
    const session = (await app.inject({ method: 'GET', url: '/api/auth/session', headers: u.headers })).json();
    expect(session.entitlements.plan).toBe('plus');
    expect((await app.inject({ method: 'GET', url: '/api/training/load', headers: u.headers })).statusCode).toBe(200);
    const cancel = subEvent('evt_2', u.id, 'canceled');
    await app.inject({ method: 'POST', url: '/api/billing/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': signed(cancel) }, payload: cancel });
    expect((await app.inject({ method: 'GET', url: '/api/training/load', headers: u.headers })).statusCode).toBe(402);
  });

  it('sin claves de Stripe, el checkout responde 503 (sin pagos simulados)', async () => {
    const u = await registerUser(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: u.headers, payload: { interval: 'month' } });
    expect(r.statusCode).toBe(503);
  });
});

describe('objetivos, estadísticas y cuenta', () => {
  it('progreso del objetivo semanal y límite del plan gratuito', async () => {
    const u = await registerUser(app);
    const g = await app.inject({ method: 'POST', url: '/api/goals', headers: u.headers, payload: { period: 'week', metric: 'distance', target: 20_000 } });
    expect(g.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/goals', headers: u.headers, payload: { period: 'week', metric: 'count', target: 3 } })).statusCode).toBe(402);
    expect((await app.inject({ method: 'POST', url: '/api/goals', headers: u.headers, payload: { period: 'month', metric: 'count', target: 3 } })).statusCode).toBe(402);
    await put(u, activityPayload({ startedAt: new Date().toISOString(), stream: straight(5000, 3) }));
    const goals = (await app.inject({ method: 'GET', url: '/api/goals?tz=Europe/Madrid', headers: u.headers })).json();
    expect(goals[0].value).toBeGreaterThan(4900);
    expect(goals[0].progress).toBeCloseTo(0.25, 1);
    const sum = (await app.inject({ method: 'GET', url: '/api/stats/summary?period=week&tz=Europe/Madrid', headers: u.headers })).json();
    expect(sum.buckets.at(-1).count).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/goals?tz=No/Existe', headers: u.headers })).statusCode).toBe(400);
  });

  it('búsqueda de lugares vía proxy con caché', async () => {
    const u = await registerUser(app);
    const r = await app.inject({ method: 'GET', url: '/api/geo/search?q=sol', headers: u.headers });
    expect(r.json()[0]).toMatchObject({ name: 'Puerta del Sol', lat: 40.4168 });
  });

  it('exportación y eliminación de cuenta', async () => {
    const u = await registerUser(app);
    await put(u, activityPayload());
    const exp = await app.inject({ method: 'GET', url: '/api/me/export', headers: u.headers });
    expect(exp.statusCode).toBe(200);
    const data = exp.json();
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0].stream.lat.length).toBeGreaterThan(100);
    expect(data.profile.password_hash).toBeUndefined();
    expect((await app.inject({ method: 'DELETE', url: '/api/me', headers: u.headers, payload: { password: 'mal' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/me', headers: u.headers, payload: { password: 'contraseña-segura-1' } })).statusCode).toBe(200);
    const left = await db.selectFrom('activities').select('id').where('owner_id', '=', u.id).execute();
    expect(left).toHaveLength(0);
  });
});
