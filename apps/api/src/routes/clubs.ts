import { ChallengeSchema, ClubSchema, PLANS } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { PageQuery, badRequest, decodeCursor, encodeCursor, forbidden, idParam, notFound, parse } from '../http.js';
import { hydrate } from '../services/activities.js';
import { getEntitlements } from '../services/entitlements.js';
import { notify, userCard } from '../services/social.js';

const METRIC_SQL = {
  distance: sql<number>`coalesce(sum(a.distance_m), 0)`,
  duration: sql<number>`coalesce(sum(a.moving_s), 0)`,
  elevation: sql<number>`coalesce(sum(a.elev_gain_m), 0)`,
  count: sql<number>`count(a.id)`,
} as const;

export async function clubRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  async function membership(clubId: string, userId: string) {
    return db.selectFrom('club_members').select(['role', 'status']).where('club_id', '=', clubId).where('user_id', '=', userId).executeTakeFirst();
  }

  async function loadClub(id: string, viewerId: string) {
    const club = await db.selectFrom('clubs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!club) throw notFound('Club');
    const m = await membership(id, viewerId);
    // Los clubes privados solo son visibles para miembros e invitados.
    if (club.visibility === 'private' && !m) throw notFound('Club');
    return { club, m };
  }

  const isAdmin = (m: { role: string; status: string } | undefined) => m?.status === 'active' && (m.role === 'owner' || m.role === 'admin');

  app.get('/clubs', async (req) => {
    const viewer = requireUser(req);
    const q = parse(z.object({ q: z.string().trim().max(60).optional(), mine: z.coerce.boolean().default(false) }), req.query);
    let query = db
      .selectFrom('clubs as c')
      .leftJoin('club_members as m', (j) => j.onRef('m.club_id', '=', 'c.id').on('m.user_id', '=', viewer.id))
      .select([
        'c.id', 'c.name', 'c.description', 'c.sport', 'c.visibility', 'm.status as myStatus', 'm.role as myRole',
        sql<number>`(select count(*) from club_members cm where cm.club_id = c.id and cm.status = 'active')`.as('members'),
      ]);
    if (q.mine) query = query.where('m.status', 'in', ['active', 'invited', 'requested']);
    else query = query.where((eb) => eb.or([eb('c.visibility', '=', 'public'), eb('m.status', 'is not', null)]));
    if (q.q) query = query.where('c.name', 'ilike', `%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    const rows = await query.orderBy('members', 'desc').limit(50).execute();
    return rows.map((r) => ({ ...r, members: Number(r.members) }));
  });

  app.post('/clubs', async (req, reply) => {
    const viewer = requireUser(req);
    const input = parse(ClubSchema, req.body);
    const ent = await getEntitlements(ctx, viewer.id);
    const owned = await db.selectFrom('clubs').select(db.fn.countAll<number>().as('n')).where('owner_id', '=', viewer.id).executeTakeFirstOrThrow();
    if (Number(owned.n) >= ent.limits.clubsOwned) {
      throw badRequest('club_limit', `Tu plan permite crear ${ent.limits.clubsOwned} club(es). ${ent.plan === 'free' ? `${PLANS.plus.name} permite ${PLANS.plus.limits.clubsOwned}.` : ''}`);
    }
    const club = await db.transaction().execute(async (trx) => {
      const c = await trx.insertInto('clubs').values({ name: input.name, description: input.description, sport: input.sport, visibility: input.visibility, owner_id: viewer.id }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('club_members').values({ club_id: c.id, user_id: viewer.id, role: 'owner', status: 'active' }).execute();
      return c;
    });
    reply.code(201);
    return { id: club.id };
  });

  app.get('/clubs/:id', async (req) => {
    const viewer = requireUser(req);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    const members = await db.selectFrom('club_members').select(db.fn.countAll<number>().as('n')).where('club_id', '=', club.id).where('status', '=', 'active').executeTakeFirstOrThrow();
    return {
      id: club.id, name: club.name, description: club.description, sport: club.sport, visibility: club.visibility,
      createdAt: club.created_at.toISOString(), members: Number(members.n),
      membership: m ? { role: m.role, status: m.status } : null,
    };
  });

  app.patch('/clubs/:id', async (req) => {
    const viewer = requireUser(req);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    if (!isAdmin(m)) throw forbidden();
    const input = parse(ClubSchema.partial(), req.body);
    await db.updateTable('clubs').set({ ...(input.name && { name: input.name }), ...(input.description !== undefined && { description: input.description }), ...(input.visibility && { visibility: input.visibility }), ...(input.sport !== undefined && { sport: input.sport }) }).where('id', '=', club.id).execute();
    return { ok: true };
  });

  app.delete('/clubs/:id', async (req) => {
    const viewer = requireUser(req);
    const { club } = await loadClub(idParam(req), viewer.id);
    if (club.owner_id !== viewer.id) throw forbidden();
    await db.deleteFrom('clubs').where('id', '=', club.id).execute();
    return { ok: true };
  });

  /** Unirse: público → activo; privado → solicitud; si había invitación → activo. */
  app.post('/clubs/:id/join', async (req) => {
    const viewer = requireUser(req);
    const id = idParam(req);
    const club = await db.selectFrom('clubs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!club) throw notFound('Club');
    const m = await membership(id, viewer.id);
    if (m?.status === 'active') return { status: 'active' };
    if (m?.status === 'invited') {
      await db.updateTable('club_members').set({ status: 'active' }).where('club_id', '=', id).where('user_id', '=', viewer.id).execute();
      return { status: 'active' };
    }
    if (m?.status === 'requested') return { status: 'requested' };
    const status = club.visibility === 'public' ? 'active' : 'requested';
    await db.insertInto('club_members').values({ club_id: id, user_id: viewer.id, role: 'member', status }).execute();
    if (status === 'requested') {
      const admins = await db.selectFrom('club_members').select('user_id').where('club_id', '=', id).where('role', 'in', ['owner', 'admin']).where('status', '=', 'active').execute();
      for (const a of admins) await notify(db, { userId: a.user_id, kind: 'club_request', actorId: viewer.id, entityId: id, data: { clubName: club.name } });
    }
    return { status };
  });

  app.post('/clubs/:id/leave', async (req) => {
    const viewer = requireUser(req);
    const id = idParam(req);
    const m = await membership(id, viewer.id);
    if (m?.role === 'owner') throw badRequest('owner_cannot_leave', 'Transfiere o elimina el club antes de salir.');
    await db.deleteFrom('club_members').where('club_id', '=', id).where('user_id', '=', viewer.id).execute();
    return { ok: true };
  });

  app.post('/clubs/:id/invite', async (req) => {
    const viewer = requireUser(req);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    if (!isAdmin(m)) throw forbidden();
    const { userId } = parse(z.object({ userId: z.uuid() }), req.body);
    const blocked = await db.selectFrom('blocks').select('blocker_id').where('blocker_id', '=', userId).where('blocked_id', '=', viewer.id).executeTakeFirst();
    if (blocked) throw forbidden('No puedes invitar a esta persona.');
    const res = await db.insertInto('club_members').values({ club_id: club.id, user_id: userId, role: 'member', status: 'invited' }).onConflict((oc) => oc.columns(['club_id', 'user_id']).doNothing()).executeTakeFirst();
    if (Number(res.numInsertedOrUpdatedRows ?? 0) > 0) await notify(db, { userId, kind: 'club_invite', actorId: viewer.id, entityId: club.id, data: { clubName: club.name } });
    return { ok: true };
  });

  app.post('/clubs/:id/members/:userId/:action', async (req) => {
    const viewer = requireUser(req);
    const { userId, action } = parse(z.object({ id: z.uuid(), userId: z.uuid(), action: z.enum(['approve', 'remove', 'promote', 'demote']) }), req.params);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    if (!isAdmin(m)) throw forbidden();
    if (userId === club.owner_id) throw forbidden('No se puede modificar al propietario.');
    const q = db.updateTable('club_members').where('club_id', '=', club.id).where('user_id', '=', userId);
    if (action === 'approve') await q.set({ status: 'active' }).where('status', '=', 'requested').execute();
    if (action === 'promote') await q.set({ role: 'admin' }).where('status', '=', 'active').execute();
    if (action === 'demote') await q.set({ role: 'member' }).execute();
    if (action === 'remove') await db.deleteFrom('club_members').where('club_id', '=', club.id).where('user_id', '=', userId).execute();
    return { ok: true };
  });

  app.get('/clubs/:id/members', async (req) => {
    const viewer = requireUser(req);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    const rows = await db
      .selectFrom('club_members as cm')
      .innerJoin('users as u', 'u.id', 'cm.user_id')
      .select(['u.id', 'u.username', 'u.display_name', 'u.avatar_path', 'u.updated_at', 'cm.role', 'cm.status'])
      .where('cm.club_id', '=', club.id)
      .where('cm.status', 'in', isAdmin(m) ? ['active', 'requested', 'invited'] : ['active'])
      .orderBy('cm.created_at')
      .limit(1000)
      .execute();
    return rows.map((r) => ({ ...userCard(r), role: r.role, status: r.status }));
  });

  /** Feed del club: actividades públicas de sus miembros (solo para miembros en clubes privados). */
  app.get('/clubs/:id/feed', async (req) => {
    const viewer = requireUser(req);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    if (club.visibility === 'private' && m?.status !== 'active') throw forbidden();
    const q = parse(PageQuery, req.query);
    const c = decodeCursor(q.cursor);
    let query = db
      .selectFrom('activities')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('owner_id', 'in', db.selectFrom('club_members').select('user_id').where('club_id', '=', club.id).where('status', '=', 'active'))
      .where((eb) => eb.or([eb('owner_id', '=', viewer.id), eb.and([eb('visibility', '=', 'public'), eb('owner_id', 'in', eb.selectFrom('users').select('id').where('is_private', '=', false))])]))
      .where('owner_id', 'not in', db.selectFrom('blocks').select('blocked_id').where('blocker_id', '=', viewer.id))
      .where('owner_id', 'not in', db.selectFrom('blocks').select('blocker_id').where('blocked_id', '=', viewer.id));
    if (club.sport) query = query.where('sport', '=', club.sport);
    if (c) query = query.where((eb) => eb.or([eb('started_at', '<', new Date(c.date)), eb.and([eb('started_at', '=', new Date(c.date)), eb('id', '<', c.id)])]));
    const rows = await query.orderBy('started_at', 'desc').orderBy('id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { items: await hydrate(db, page, viewer.id), nextCursor: rows.length > q.limit && last ? encodeCursor(last.started_at, last.id) : null };
  });

  /** Clasificación semanal del club (distancia en actividades no privadas). */
  app.get('/clubs/:id/leaderboard', async (req) => {
    const viewer = requireUser(req);
    const { club, m } = await loadClub(idParam(req), viewer.id);
    if (club.visibility === 'private' && m?.status !== 'active') throw forbidden();
    const rows = await db
      .selectFrom('club_members as cm')
      .innerJoin('users as u', 'u.id', 'cm.user_id')
      .leftJoin('activities as a', (j) =>
        j.onRef('a.owner_id', '=', 'cm.user_id')
          .on('a.deleted_at', 'is', null)
          .on('a.visibility', '<>', 'private')
          .on('a.started_at', '>=', sql<Date>`date_trunc('week', now())`)
          .on((eb) => (club.sport ? eb('a.sport', '=', club.sport) : eb.lit(true))),
      )
      .select(['u.id', 'u.username', 'u.display_name', 'u.avatar_path', 'u.updated_at', METRIC_SQL.distance.as('distanceM'), METRIC_SQL.duration.as('movingS'), METRIC_SQL.count.as('count')])
      .where('cm.club_id', '=', club.id)
      .where('cm.status', '=', 'active')
      .groupBy(['u.id', 'u.username', 'u.display_name', 'u.avatar_path', 'u.updated_at'])
      .orderBy('distanceM', 'desc')
      .limit(100)
      .execute();
    return rows.map((r, i) => ({ rank: i + 1, user: userCard(r), distanceM: Number(r.distanceM), movingS: Number(r.movingS), count: Number(r.count) }));
  });

  /* ───────────── Retos ───────────── */

  async function canAccessChallenge(ch: { club_id: string | null }, viewerId: string) {
    if (!ch.club_id) return true;
    const club = await db.selectFrom('clubs').select('visibility').where('id', '=', ch.club_id).executeTakeFirst();
    if (club?.visibility === 'public') return true;
    return (await membership(ch.club_id, viewerId))?.status === 'active';
  }

  app.get('/challenges', async (req) => {
    const viewer = requireUser(req);
    const { scope } = parse(z.object({ scope: z.enum(['active', 'joined', 'past']).default('active') }), req.query);
    let q = db
      .selectFrom('challenges as c')
      .leftJoin('challenge_participants as p', (j) => j.onRef('p.challenge_id', '=', 'c.id').on('p.user_id', '=', viewer.id))
      .leftJoin('clubs as cl', 'cl.id', 'c.club_id')
      .select([
        'c.id', 'c.title', 'c.description', 'c.sport', 'c.metric', 'c.target', 'c.starts_at', 'c.ends_at', 'c.club_id', 'cl.name as clubName',
        'p.joined_at',
        sql<number>`(select count(*) from challenge_participants cp where cp.challenge_id = c.id)`.as('participants'),
      ])
      .where((eb) => eb.or([
        eb('c.club_id', 'is', null),
        eb('cl.visibility', '=', 'public'),
        eb('c.club_id', 'in', eb.selectFrom('club_members').select('club_id').where('user_id', '=', viewer.id).where('status', '=', 'active')),
      ]));
    if (scope === 'active') q = q.where('c.ends_at', '>', sql<Date>`now()`);
    if (scope === 'past') q = q.where('c.ends_at', '<=', sql<Date>`now()`);
    if (scope === 'joined') q = q.where('p.user_id', 'is not', null);
    const rows = await q.orderBy('c.ends_at').limit(100).execute();
    return rows.map((r) => ({
      id: r.id, title: r.title, description: r.description, sport: r.sport, metric: r.metric, target: r.target,
      startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
      clubId: r.club_id, clubName: r.clubName, joined: r.joined_at != null, participants: Number(r.participants),
    }));
  });

  app.post('/challenges', async (req, reply) => {
    const viewer = requireUser(req);
    const input = parse(ChallengeSchema, req.body);
    if (input.clubId && !isAdmin(await membership(input.clubId, viewer.id))) throw forbidden('Solo la administración del club puede crear retos del club.');
    const ch = await db
      .insertInto('challenges')
      .values({ title: input.title, description: input.description, sport: input.sport, metric: input.metric, target: input.target, starts_at: input.startsAt, ends_at: input.endsAt, club_id: input.clubId, created_by: viewer.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.insertInto('challenge_participants').values({ challenge_id: ch.id, user_id: viewer.id }).execute();
    reply.code(201);
    return { id: ch.id };
  });

  app.get('/challenges/:id', async (req) => {
    const viewer = requireUser(req);
    const ch = await db.selectFrom('challenges').selectAll().where('id', '=', idParam(req)).executeTakeFirst();
    if (!ch || !(await canAccessChallenge(ch, viewer.id))) throw notFound('Reto');
    // Progreso: suma de actividades no privadas de cada participante dentro de la ventana del reto.
    const board = await db
      .selectFrom('challenge_participants as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .leftJoin('activities as a', (j) =>
        j.onRef('a.owner_id', '=', 'p.user_id')
          .on('a.deleted_at', 'is', null)
          .on((eb) => eb.or([eb('a.visibility', '<>', 'private'), eb('a.owner_id', '=', viewer.id)]))
          .on('a.started_at', '>=', new Date(ch.starts_at))
          .on('a.started_at', '<', new Date(ch.ends_at))
          .on((eb) => (ch.sport ? eb('a.sport', '=', ch.sport) : eb.lit(true))),
      )
      .select(['u.id', 'u.username', 'u.display_name', 'u.avatar_path', 'u.updated_at', METRIC_SQL[ch.metric].as('value')])
      .where('p.challenge_id', '=', ch.id)
      .where('p.user_id', 'not in', db.selectFrom('blocks').select('blocked_id').where('blocker_id', '=', viewer.id))
      .groupBy(['u.id', 'u.username', 'u.display_name', 'u.avatar_path', 'u.updated_at'])
      .orderBy('value', 'desc')
      .limit(200)
      .execute();
    const joined = board.some((b) => b.id === viewer.id);
    return {
      id: ch.id, title: ch.title, description: ch.description, sport: ch.sport, metric: ch.metric, target: ch.target,
      startsAt: new Date(ch.starts_at).toISOString(), endsAt: new Date(ch.ends_at).toISOString(), clubId: ch.club_id,
      joined,
      leaderboard: board.map((b, i) => ({ rank: i + 1, user: userCard(b), value: Number(b.value), completed: Number(b.value) >= ch.target })),
    };
  });

  app.post('/challenges/:id/join', async (req) => {
    const viewer = requireUser(req);
    const ch = await db.selectFrom('challenges').selectAll().where('id', '=', idParam(req)).executeTakeFirst();
    if (!ch) throw notFound('Reto');
    if (ch.club_id && (await membership(ch.club_id, viewer.id))?.status !== 'active') throw forbidden('Únete al club para participar.');
    if (new Date(ch.ends_at) < new Date()) throw badRequest('challenge_ended', 'El reto ha terminado.');
    await db.insertInto('challenge_participants').values({ challenge_id: ch.id, user_id: viewer.id }).onConflict((oc) => oc.columns(['challenge_id', 'user_id']).doNothing()).execute();
    return { ok: true };
  });

  app.post('/challenges/:id/leave', async (req) => {
    const viewer = requireUser(req);
    await db.deleteFrom('challenge_participants').where('challenge_id', '=', idParam(req)).where('user_id', '=', viewer.id).execute();
    return { ok: true };
  });
}
