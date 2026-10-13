import { CommentSchema, ReportSchema } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireModerator, requireUser } from '../auth.js';
import { PageQuery, badRequest, decodeCursor, encodeCursor, forbidden, idParam, notFound, parse } from '../http.js';
import { deleteActivity, hydrate, loadVisibleActivity } from '../services/activities.js';
import { avatarUrl, notify, relation, userCard } from '../services/social.js';

const UserIdParam = z.object({ id: z.uuid() });

export async function socialRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  /* ───────────── Usuarios y perfiles ───────────── */

  app.get('/users', async (req) => {
    const viewer = requireUser(req);
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db
      .selectFrom('users')
      .select(['id', 'username', 'display_name', 'avatar_path', 'updated_at'])
      .where((eb) => eb.or([eb('username', 'ilike', like), eb('display_name', 'ilike', like)]))
      .where('suspended_at', 'is', null)
      .where('id', 'not in', db.selectFrom('blocks').select('blocked_id').where('blocker_id', '=', viewer.id))
      .where('id', 'not in', db.selectFrom('blocks').select('blocker_id').where('blocked_id', '=', viewer.id))
      .orderBy('username')
      .limit(20)
      .execute();
    return rows.map(userCard);
  });

  app.get('/users/:username', async (req) => {
    const viewer = requireUser(req);
    const { username } = parse(z.object({ username: z.string().min(1).max(40) }), req.params);
    const u = await db.selectFrom('users').selectAll().where('username', '=', username).where('suspended_at', 'is', null).executeTakeFirst();
    if (!u) throw notFound('Usuario');
    const rel = await relation(db, viewer.id, u.id);
    if (rel.blocked && !rel.blockedByViewer) throw notFound('Usuario');
    const [followers, following, followsYou] = await Promise.all([
      db.selectFrom('follows').select(db.fn.countAll<number>().as('n')).where('followee_id', '=', u.id).where('status', '=', 'accepted').executeTakeFirstOrThrow(),
      db.selectFrom('follows').select(db.fn.countAll<number>().as('n')).where('follower_id', '=', u.id).where('status', '=', 'accepted').executeTakeFirstOrThrow(),
      db.selectFrom('follows').select('status').where('follower_id', '=', u.id).where('followee_id', '=', viewer.id).where('status', '=', 'accepted').executeTakeFirst(),
    ]);
    const canSeeDetails = rel.self || (!rel.blocked && (!u.is_private || rel.follower));
    let yearStats = null;
    if (canSeeDetails) {
      const levels = rel.self ? ['public', 'followers', 'private'] : rel.follower ? ['public', 'followers'] : ['public'];
      yearStats = await db
        .selectFrom('activities')
        .select([
          db.fn.countAll<number>().as('count'),
          db.fn.coalesce(db.fn.sum<number>('distance_m'), sql<number>`0`).as('distanceM'),
          db.fn.coalesce(db.fn.sum<number>('moving_s'), sql<number>`0`).as('movingS'),
          db.fn.coalesce(db.fn.sum<number>('elev_gain_m'), sql<number>`0`).as('elevGainM'),
        ])
        .where('owner_id', '=', u.id)
        .where('deleted_at', 'is', null)
        .where('visibility', 'in', levels as Array<'public'>)
        .where('started_at', '>=', sql<Date>`date_trunc('year', now())`)
        .executeTakeFirst();
    }
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarUrl: avatarUrl(u.id, u.avatar_path, u.updated_at),
      bio: canSeeDetails ? u.bio : '',
      location: canSeeDetails ? u.location : '',
      isPrivate: u.is_private,
      createdAt: u.created_at.toISOString(),
      followers: Number(followers.n),
      following: Number(following.n),
      relation: {
        self: rel.self,
        following: rel.follower && !rel.self,
        pending: rel.pending,
        followsYou: !!followsYou,
        blocked: rel.blockedByViewer,
      },
      canSeeActivities: canSeeDetails,
      yearStats: yearStats && { count: Number(yearStats.count), distanceM: Number(yearStats.distanceM), movingS: Number(yearStats.movingS), elevGainM: Number(yearStats.elevGainM) },
    };
  });

  async function followList(req: { query: unknown; params: unknown; user: { id: string } | null }, direction: 'followers' | 'following') {
    const viewer = requireUser(req as never);
    const { id } = parse(UserIdParam, req.params);
    const u = await db.selectFrom('users').select(['is_private']).where('id', '=', id).executeTakeFirst();
    if (!u) throw notFound('Usuario');
    const rel = await relation(db, viewer.id, id);
    if (rel.blocked || (u.is_private && !rel.follower)) return [];
    const [mine, theirs] = direction === 'followers' ? (['followee_id', 'follower_id'] as const) : (['follower_id', 'followee_id'] as const);
    const rows = await db
      .selectFrom('follows')
      .innerJoin('users', 'users.id', `follows.${theirs}`)
      .select(['users.id', 'users.username', 'users.display_name', 'users.avatar_path', 'users.updated_at'])
      .where(`follows.${mine}`, '=', id)
      .where('follows.status', '=', 'accepted')
      .orderBy('follows.created_at', 'desc')
      .limit(500)
      .execute();
    return rows.map(userCard);
  }

  app.get('/users/:id/followers', (req) => followList(req, 'followers'));
  app.get('/users/:id/following', (req) => followList(req, 'following'));

  app.post('/users/:id/follow', async (req) => {
    const viewer = requireUser(req);
    const { id } = parse(UserIdParam, req.params);
    if (id === viewer.id) throw badRequest('self_follow', 'No puedes seguirte a ti mismo.');
    const target = await db.selectFrom('users').select(['id', 'is_private']).where('id', '=', id).where('suspended_at', 'is', null).executeTakeFirst();
    if (!target) throw notFound('Usuario');
    const rel = await relation(db, viewer.id, id);
    if (rel.blocked) throw forbidden('No puedes seguir a esta persona.');
    const status = target.is_private ? 'pending' : 'accepted';
    const res = await db
      .insertInto('follows')
      .values({ follower_id: viewer.id, followee_id: id, status })
      .onConflict((oc) => oc.columns(['follower_id', 'followee_id']).doNothing())
      .executeTakeFirst();
    if (Number(res.numInsertedOrUpdatedRows ?? 0) > 0) {
      await notify(db, { userId: id, kind: status === 'pending' ? 'follow_request' : 'follow', actorId: viewer.id });
    }
    const row = await db.selectFrom('follows').select('status').where('follower_id', '=', viewer.id).where('followee_id', '=', id).executeTakeFirstOrThrow();
    return { status: row.status };
  });

  app.delete('/users/:id/follow', async (req) => {
    const viewer = requireUser(req);
    const { id } = parse(UserIdParam, req.params);
    await db.deleteFrom('follows').where('follower_id', '=', viewer.id).where('followee_id', '=', id).execute();
    return { ok: true };
  });

  /** Eliminar a un seguidor propio. */
  app.delete('/me/followers/:id', async (req) => {
    const viewer = requireUser(req);
    const { id } = parse(UserIdParam, req.params);
    await db.deleteFrom('follows').where('follower_id', '=', id).where('followee_id', '=', viewer.id).execute();
    return { ok: true };
  });

  app.get('/me/follow-requests', async (req) => {
    const viewer = requireUser(req);
    const rows = await db
      .selectFrom('follows')
      .innerJoin('users', 'users.id', 'follows.follower_id')
      .select(['users.id', 'users.username', 'users.display_name', 'users.avatar_path', 'users.updated_at'])
      .where('follows.followee_id', '=', viewer.id)
      .where('follows.status', '=', 'pending')
      .orderBy('follows.created_at', 'desc')
      .execute();
    return rows.map(userCard);
  });

  app.post('/me/follow-requests/:id/:action', async (req) => {
    const viewer = requireUser(req);
    const { id, action } = parse(z.object({ id: z.uuid(), action: z.enum(['accept', 'reject']) }), req.params);
    if (action === 'accept') {
      const r = await db.updateTable('follows').set({ status: 'accepted' }).where('follower_id', '=', id).where('followee_id', '=', viewer.id).where('status', '=', 'pending').executeTakeFirst();
      if (Number(r.numUpdatedRows) > 0) await notify(db, { userId: id, kind: 'follow_accepted', actorId: viewer.id });
    } else {
      await db.deleteFrom('follows').where('follower_id', '=', id).where('followee_id', '=', viewer.id).where('status', '=', 'pending').execute();
    }
    return { ok: true };
  });

  /* ───────────── Bloqueos ───────────── */

  app.post('/users/:id/block', async (req) => {
    const viewer = requireUser(req);
    const { id } = parse(UserIdParam, req.params);
    if (id === viewer.id) throw badRequest('self_block', 'No puedes bloquearte.');
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('blocks').values({ blocker_id: viewer.id, blocked_id: id }).onConflict((oc) => oc.columns(['blocker_id', 'blocked_id']).doNothing()).execute();
      // El bloqueo rompe la relación en ambos sentidos.
      await trx
        .deleteFrom('follows')
        .where((eb) => eb.or([
          eb.and([eb('follower_id', '=', viewer.id), eb('followee_id', '=', id)]),
          eb.and([eb('follower_id', '=', id), eb('followee_id', '=', viewer.id)]),
        ]))
        .execute();
    });
    return { ok: true };
  });

  app.delete('/users/:id/block', async (req) => {
    const viewer = requireUser(req);
    const { id } = parse(UserIdParam, req.params);
    await db.deleteFrom('blocks').where('blocker_id', '=', viewer.id).where('blocked_id', '=', id).execute();
    return { ok: true };
  });

  app.get('/me/blocks', async (req) => {
    const viewer = requireUser(req);
    const rows = await db
      .selectFrom('blocks')
      .innerJoin('users', 'users.id', 'blocks.blocked_id')
      .select(['users.id', 'users.username', 'users.display_name', 'users.avatar_path', 'users.updated_at'])
      .where('blocks.blocker_id', '=', viewer.id)
      .execute();
    return rows.map(userCard);
  });

  /* ───────────── Feed ───────────── */

  app.get('/feed', async (req) => {
    const viewer = requireUser(req);
    const q = parse(PageQuery, req.query);
    const c = decodeCursor(q.cursor);
    let query = db
      .selectFrom('activities')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('owner_id', '=', viewer.id),
          eb.and([
            eb('owner_id', 'in', eb.selectFrom('follows').select('followee_id').where('follower_id', '=', viewer.id).where('status', '=', 'accepted')),
            eb('visibility', 'in', ['public', 'followers']),
          ]),
        ]),
      )
      .where('owner_id', 'not in', db.selectFrom('blocks').select('blocked_id').where('blocker_id', '=', viewer.id))
      .where('owner_id', 'not in', db.selectFrom('blocks').select('blocker_id').where('blocked_id', '=', viewer.id))
      .where('owner_id', 'in', db.selectFrom('users').select('id').where('suspended_at', 'is', null));
    if (c) query = query.where((eb) => eb.or([eb('started_at', '<', new Date(c.date)), eb.and([eb('started_at', '=', new Date(c.date)), eb('id', '<', c.id)])]));
    const rows = await query.orderBy('started_at', 'desc').orderBy('id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { items: await hydrate(db, page, viewer.id), nextCursor: rows.length > q.limit && last ? encodeCursor(last.started_at, last.id) : null };
  });

  /* ───────────── Reacciones y comentarios ───────────── */

  app.put('/activities/:id/reaction', async (req) => {
    const viewer = requireUser(req);
    const a = await loadVisibleActivity(db, idParam(req), viewer.id);
    const res = await db.insertInto('reactions').values({ activity_id: a.id, user_id: viewer.id }).onConflict((oc) => oc.columns(['activity_id', 'user_id']).doNothing()).executeTakeFirst();
    if (Number(res.numInsertedOrUpdatedRows ?? 0) > 0) {
      await notify(db, { userId: a.owner_id, kind: 'reaction', actorId: viewer.id, entityId: a.id, data: { activityName: a.name } });
    }
    return { ok: true };
  });

  app.delete('/activities/:id/reaction', async (req) => {
    const viewer = requireUser(req);
    await db.deleteFrom('reactions').where('activity_id', '=', idParam(req)).where('user_id', '=', viewer.id).execute();
    return { ok: true };
  });

  app.get('/activities/:id/comments', async (req) => {
    const viewer = requireUser(req);
    const a = await loadVisibleActivity(db, idParam(req), viewer.id);
    const rows = await db
      .selectFrom('comments')
      .innerJoin('users', 'users.id', 'comments.author_id')
      .select(['comments.id', 'comments.body', 'comments.created_at', 'users.id as uid', 'users.username', 'users.display_name', 'users.avatar_path', 'users.updated_at'])
      .where('comments.activity_id', '=', a.id)
      .where('comments.deleted_at', 'is', null)
      .where('comments.author_id', 'not in', db.selectFrom('blocks').select('blocked_id').where('blocker_id', '=', viewer.id))
      .orderBy('comments.created_at')
      .limit(500)
      .execute();
    return rows.map((r) => ({
      id: r.id, body: r.body, createdAt: r.created_at.toISOString(),
      author: userCard({ id: r.uid, username: r.username, display_name: r.display_name, avatar_path: r.avatar_path, updated_at: r.updated_at }),
      canDelete: r.uid === viewer.id || a.owner_id === viewer.id,
    }));
  });

  app.post('/activities/:id/comments', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const viewer = requireUser(req);
    const a = await loadVisibleActivity(db, idParam(req), viewer.id);
    const { body } = parse(CommentSchema, req.body);
    const row = await db.insertInto('comments').values({ activity_id: a.id, author_id: viewer.id, body }).returning(['id', 'created_at']).executeTakeFirstOrThrow();
    await notify(db, { userId: a.owner_id, kind: 'comment', actorId: viewer.id, entityId: a.id, data: { activityName: a.name, excerpt: body.slice(0, 80) } });
    reply.code(201);
    return { id: row.id, createdAt: row.created_at.toISOString() };
  });

  app.delete('/comments/:id', async (req) => {
    const viewer = requireUser(req);
    const c = await db
      .selectFrom('comments')
      .innerJoin('activities', 'activities.id', 'comments.activity_id')
      .select(['comments.id', 'comments.author_id', 'activities.owner_id'])
      .where('comments.id', '=', idParam(req))
      .executeTakeFirst();
    if (!c) return { ok: true };
    const isMod = viewer.role !== 'user';
    if (c.author_id !== viewer.id && c.owner_id !== viewer.id && !isMod) throw forbidden();
    await db.updateTable('comments').set({ deleted_at: new Date() }).where('id', '=', c.id).execute();
    return { ok: true };
  });

  /* ───────────── Notificaciones ───────────── */

  app.get('/notifications', async (req) => {
    const viewer = requireUser(req);
    const q = parse(PageQuery, req.query);
    const c = decodeCursor(q.cursor);
    let query = db
      .selectFrom('notifications as n')
      .leftJoin('users as a', 'a.id', 'n.actor_id')
      .select(['n.id', 'n.kind', 'n.entity_id', 'n.data', 'n.read_at', 'n.created_at', 'a.id as actor_id', 'a.username', 'a.display_name', 'a.avatar_path', 'a.updated_at'])
      .where('n.user_id', '=', viewer.id);
    if (c) query = query.where((eb) => eb.or([eb('n.created_at', '<', new Date(c.date)), eb.and([eb('n.created_at', '=', new Date(c.date)), eb('n.id', '<', c.id)])]));
    const rows = await query.orderBy('n.created_at', 'desc').orderBy('n.id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    const unread = await db.selectFrom('notifications').select(db.fn.countAll<number>().as('n')).where('user_id', '=', viewer.id).where('read_at', 'is', null).executeTakeFirstOrThrow();
    const last = page[page.length - 1];
    return {
      unread: Number(unread.n),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null,
      items: page.map((r) => ({
        id: r.id, kind: r.kind, entityId: r.entity_id, data: r.data, read: r.read_at != null, createdAt: r.created_at.toISOString(),
        actor: r.actor_id ? userCard({ id: r.actor_id, username: r.username!, display_name: r.display_name!, avatar_path: r.avatar_path ?? null, updated_at: r.updated_at ?? undefined }) : null,
      })),
    };
  });

  app.post('/notifications/read', async (req) => {
    const viewer = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(200).optional() }), req.body ?? {});
    let q = db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', viewer.id).where('read_at', 'is', null);
    if (ids) q = q.where('id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    await q.execute();
    return { ok: true };
  });

  /* ───────────── Denuncias y moderación ───────────── */

  app.post('/reports', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const viewer = requireUser(req);
    const r = parse(ReportSchema, req.body);
    await db.insertInto('reports').values({ reporter_id: viewer.id, target_type: r.targetType, target_id: r.targetId, reason: r.reason, details: r.details }).execute();
    reply.code(201);
    return { ok: true };
  });

  app.get('/moderation/reports', async (req) => {
    requireModerator(req);
    const { status } = parse(z.object({ status: z.enum(['open', 'resolved', 'dismissed']).default('open') }), req.query);
    const rows = await db
      .selectFrom('reports')
      .innerJoin('users', 'users.id', 'reports.reporter_id')
      .select(['reports.id', 'reports.target_type', 'reports.target_id', 'reports.reason', 'reports.details', 'reports.status', 'reports.created_at', 'users.username as reporter'])
      .where('reports.status', '=', status)
      .orderBy('reports.created_at')
      .limit(200)
      .execute();
    return rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at.toISOString(), reporter: r.reporter }));
  });

  app.post('/moderation/reports/:id/resolve', async (req) => {
    const mod = requireModerator(req);
    const { action, note } = parse(z.object({ action: z.enum(['dismiss', 'remove_content', 'suspend_user']), note: z.string().max(500).default('') }), req.body);
    const report = await db.selectFrom('reports').selectAll().where('id', '=', idParam(req)).executeTakeFirst();
    if (!report) throw notFound('Denuncia');
    if (action === 'remove_content') {
      if (report.target_type === 'comment') await db.updateTable('comments').set({ deleted_at: new Date() }).where('id', '=', report.target_id).execute();
      else if (report.target_type === 'activity') {
        const a = await db.selectFrom('activities').selectAll().where('id', '=', report.target_id).executeTakeFirst();
        if (a) await deleteActivity(ctx, a);
      } else if (report.target_type === 'club') await db.deleteFrom('clubs').where('id', '=', report.target_id).execute();
      else throw badRequest('invalid_action', 'Para usuarios usa la suspensión.');
    }
    if (action === 'suspend_user') {
      let userId = report.target_type === 'user' ? report.target_id : null;
      if (report.target_type === 'activity') userId = (await db.selectFrom('activities').select('owner_id').where('id', '=', report.target_id).executeTakeFirst())?.owner_id ?? null;
      if (report.target_type === 'comment') userId = (await db.selectFrom('comments').select('author_id').where('id', '=', report.target_id).executeTakeFirst())?.author_id ?? null;
      if (!userId) throw notFound('Usuario');
      await db.updateTable('users').set({ suspended_at: new Date() }).where('id', '=', userId).where('role', '=', 'user').execute();
      await db.deleteFrom('sessions').where('user_id', '=', userId).execute();
    }
    await db
      .updateTable('reports')
      .set({ status: action === 'dismiss' ? 'dismissed' : 'resolved', resolution: `${action}${note ? `: ${note}` : ''}`, resolved_by: mod.id, resolved_at: new Date() })
      .where('id', '=', report.id)
      .execute();
    return { ok: true };
  });
}
