import { GoalSchema, TRAINING_PLANS, fitnessSeries, hasFeature, planWeek } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { badRequest, idParam, notFound, parse, premiumRequired } from '../http.js';
import { getEntitlements, requireFeature } from '../services/entitlements.js';

/** Zona horaria IANA válida (se usa también en SQL; validar evita errores de PostgreSQL). */
const Tz = z
  .string()
  .max(64)
  .default('UTC')
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Zona horaria no válida');

const METRIC_COL = {
  distance: sql<number>`coalesce(sum(distance_m), 0)`,
  duration: sql<number>`coalesce(sum(moving_s), 0)`,
  elevation: sql<number>`coalesce(sum(elev_gain_m), 0)`,
  count: sql<number>`count(*)`,
} as const;

export async function trainingRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  /* ───────────── Objetivos ───────────── */

  app.get('/goals', async (req) => {
    const viewer = requireUser(req);
    const { tz } = parse(z.object({ tz: Tz }), req.query);
    const goals = await db.selectFrom('goals').selectAll().where('user_id', '=', viewer.id).where('archived_at', 'is', null).orderBy('created_at').execute();
    const out = [];
    for (const g of goals) {
      const start = sql<Date>`(date_trunc(${g.period}, now() at time zone ${tz}) at time zone ${tz})`;
      const end = sql<Date>`((date_trunc(${g.period}, now() at time zone ${tz}) + ${sql.lit(`1 ${g.period}`)}::interval) at time zone ${tz})`;
      let q = db
        .selectFrom('activities')
        .select([METRIC_COL[g.metric].as('value'), start.as('start'), end.as('end')])
        .where('owner_id', '=', viewer.id)
        .where('deleted_at', 'is', null)
        .where('started_at', '>=', start)
        .where('started_at', '<', end);
      if (g.sport) q = q.where('sport', '=', g.sport);
      const r = await q.executeTakeFirstOrThrow();
      out.push({
        id: g.id, period: g.period, metric: g.metric, sport: g.sport, target: g.target,
        value: Number(r.value), progress: Math.min(1, Number(r.value) / g.target),
        periodStart: new Date(r.start).toISOString(), periodEnd: new Date(r.end).toISOString(),
      });
    }
    return out;
  });

  app.post('/goals', async (req, reply) => {
    const viewer = requireUser(req);
    const input = parse(GoalSchema, req.body);
    const ent = await getEntitlements(ctx, viewer.id);
    if (input.period !== 'week' && !hasFeature(ent, 'goals.multiple')) throw premiumRequired('goals.multiple');
    const active = await db.selectFrom('goals').select(db.fn.countAll<number>().as('n')).where('user_id', '=', viewer.id).where('archived_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(active.n) >= ent.limits.activeGoals) {
      if (ent.plan === 'free') throw premiumRequired('goals.multiple');
      throw badRequest('goal_limit', `Máximo ${ent.limits.activeGoals} objetivos activos.`);
    }
    const g = await db.insertInto('goals').values({ user_id: viewer.id, period: input.period, metric: input.metric, sport: input.sport, target: input.target }).returning('id').executeTakeFirstOrThrow();
    reply.code(201);
    return { id: g.id };
  });

  app.delete('/goals/:id', async (req) => {
    const viewer = requireUser(req);
    await db.updateTable('goals').set({ archived_at: new Date() }).where('id', '=', idParam(req)).where('user_id', '=', viewer.id).execute();
    return { ok: true };
  });

  /* ───────────── Estadísticas ───────────── */

  /** Resumen por semana/mes/año. El plan gratuito ve los últimos 12 meses. */
  app.get('/stats/summary', async (req) => {
    const viewer = requireUser(req);
    const q = parse(z.object({ period: z.enum(['week', 'month', 'year']).default('week'), tz: Tz, sport: z.string().max(30).optional(), count: z.coerce.number().int().min(1).max(260).default(12) }), req.query);
    const ent = await getEntitlements(ctx, viewer.id);
    const bucket = sql<Date>`date_trunc(${q.period}, started_at at time zone ${q.tz})`;
    const span = sql.lit(`${q.count} ${q.period}`);
    let query = db
      .selectFrom('activities')
      .select([
        bucket.as('bucket'),
        sql<number>`count(*)`.as('count'),
        sql<number>`coalesce(sum(distance_m),0)`.as('distanceM'),
        sql<number>`coalesce(sum(moving_s),0)`.as('movingS'),
        sql<number>`coalesce(sum(elev_gain_m),0)`.as('elevGainM'),
      ])
      .where('owner_id', '=', viewer.id)
      .where('deleted_at', 'is', null)
      .where('started_at', '>=', sql<Date>`(date_trunc(${q.period}, now() at time zone ${q.tz}) - ${span}::interval + ${sql.lit(`1 ${q.period}`)}::interval) at time zone ${q.tz}`);
    if (ent.limits.statsHistoryMonths != null) {
      query = query.where('started_at', '>=', sql<Date>`now() - ${sql.lit(`${ent.limits.statsHistoryMonths} months`)}::interval`);
    }
    if (q.sport) query = query.where('sport', '=', q.sport);
    const rows = await query.groupBy('bucket').orderBy('bucket').execute();
    return {
      limitedTo: ent.limits.statsHistoryMonths,
      buckets: rows.map((r) => ({
        start: new Date(r.bucket).toISOString().slice(0, 10),
        count: Number(r.count), distanceM: Number(r.distanceM), movingS: Number(r.movingS), elevGainM: Number(r.elevGainM),
      })),
    };
  });

  /** Comparativa del periodo actual con el anterior y con el mismo periodo del año pasado (Plus). */
  app.get('/stats/compare', async (req) => {
    const viewer = requireUser(req);
    await requireFeature(ctx, viewer.id, 'stats.periodCompare');
    const q = parse(z.object({ period: z.enum(['week', 'month', 'year']).default('month'), tz: Tz, sport: z.string().max(30).optional() }), req.query);
    const agg = async (offset: string) => {
      const start = sql<Date>`((date_trunc(${q.period}, now() at time zone ${q.tz}) - ${sql.lit(offset)}::interval) at time zone ${q.tz})`;
      const elapsedSoFar = sql<Date>`(now() - ${sql.lit(offset)}::interval)`;
      let query = db
        .selectFrom('activities')
        .select([sql<number>`count(*)`.as('count'), sql<number>`coalesce(sum(distance_m),0)`.as('distanceM'), sql<number>`coalesce(sum(moving_s),0)`.as('movingS'), sql<number>`coalesce(sum(elev_gain_m),0)`.as('elevGainM'), start.as('start')])
        .where('owner_id', '=', viewer.id)
        .where('deleted_at', 'is', null)
        .where('started_at', '>=', start)
        .where('started_at', '<', elapsedSoFar);
      if (q.sport) query = query.where('sport', '=', q.sport);
      const r = await query.executeTakeFirstOrThrow();
      return { start: new Date(r.start).toISOString(), count: Number(r.count), distanceM: Number(r.distanceM), movingS: Number(r.movingS), elevGainM: Number(r.elevGainM) };
    };
    // "Hasta la misma fecha relativa" para comparar periodos en curso de forma justa.
    return {
      period: q.period,
      current: await agg('0 days'),
      previous: await agg(`1 ${q.period}`),
      lastYear: q.period === 'year' ? null : await agg('1 year'),
    };
  });

  /* ───────────── Carga, forma y fatiga (Plus) ───────────── */

  app.get('/training/load', async (req) => {
    const viewer = requireUser(req);
    await requireFeature(ctx, viewer.id, 'training.load');
    const q = parse(z.object({ tz: Tz, days: z.coerce.number().int().min(14).max(730).default(120) }), req.query);
    // Se cargan 84 días extra para que CTL (42 d) arranque estabilizado.
    const rows = await db
      .selectFrom('activities')
      .select([sql<string>`to_char(started_at at time zone ${q.tz}, 'YYYY-MM-DD')`.as('date'), sql<number>`coalesce(sum(training_load),0)`.as('load'), sql<number>`count(*) filter (where training_load is null)`.as('missing')])
      .where('owner_id', '=', viewer.id)
      .where('deleted_at', 'is', null)
      .where('started_at', '>=', sql<Date>`now() - ${sql.lit(`${q.days + 84} days`)}::interval`)
      .groupBy('date')
      .execute();
    const now = Date.now();
    const series = fitnessSeries(rows.map((r) => ({ date: r.date, load: Number(r.load) })), now - (q.days + 84) * 86_400_000, now).slice(-q.days);
    return {
      series,
      activitiesWithoutLoad: rows.reduce((a, r) => a + Number(r.missing), 0),
      method: 'TRIMP de Edwards con frecuencia cardíaca; sRPE (minutos × esfuerzo percibido) si no hay FC. CTL 42 d, ATL 7 d.',
    };
  });

  /* ───────────── Planes de entrenamiento ───────────── */

  app.get('/training/plans', async () =>
    TRAINING_PLANS.map((p) => ({ key: p.key, title: p.title, sport: p.sport, level: p.level, weeks: p.weeks, summary: p.summary })),
  );

  app.post('/training/plans/enroll', async (req, reply) => {
    const viewer = requireUser(req);
    await requireFeature(ctx, viewer.id, 'training.plans');
    const input = parse(z.object({ key: z.string(), startDate: z.iso.date() }), req.body);
    if (!TRAINING_PLANS.some((p) => p.key === input.key)) throw notFound('Plan');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('plan_enrollments').set({ ended_at: new Date() }).where('user_id', '=', viewer.id).where('ended_at', 'is', null).execute();
      await trx.insertInto('plan_enrollments').values({ user_id: viewer.id, plan_key: input.key, start_date: input.startDate }).execute();
    });
    reply.code(201);
    return { ok: true };
  });

  app.delete('/training/plans/current', async (req) => {
    const viewer = requireUser(req);
    await db.updateTable('plan_enrollments').set({ ended_at: new Date() }).where('user_id', '=', viewer.id).where('ended_at', 'is', null).execute();
    return { ok: true };
  });

  /** Plan activo con sesiones y estado (hecha si hay una actividad del deporte ese día). */
  app.get('/training/plans/current', async (req) => {
    const viewer = requireUser(req);
    const { tz } = parse(z.object({ tz: Tz }), req.query);
    const e = await db.selectFrom('plan_enrollments').selectAll().where('user_id', '=', viewer.id).where('ended_at', 'is', null).executeTakeFirst();
    if (!e) return null;
    const tpl = TRAINING_PLANS.find((p) => p.key === e.plan_key);
    if (!tpl) return null;
    const start = new Date(`${e.start_date}T12:00:00Z`);
    const days = await db
      .selectFrom('activities')
      .select(sql<string>`to_char(started_at at time zone ${tz}, 'YYYY-MM-DD')`.as('date'))
      .where('owner_id', '=', viewer.id)
      .where('deleted_at', 'is', null)
      .where('started_at', '>=', new Date(start.getTime() - 36 * 3_600_000))
      .where('sport', 'in', tpl.sport === 'run' ? ['run', 'trail_run'] : ['ride', 'mtb'])
      .execute();
    const done = new Set(days.map((d) => d.date));
    const weeks = [];
    for (let w = 1; w <= tpl.weeks; w++) {
      weeks.push({
        week: w,
        sessions: planWeek(tpl, start, w).map((s) => {
          const date = s.date.toISOString().slice(0, 10);
          return { day: s.day, kind: s.kind, title: s.title, minutes: s.minutes, detail: s.detail, date, done: done.has(date) };
        }),
      });
    }
    return { key: tpl.key, title: tpl.title, sport: tpl.sport, weeks, startDate: e.start_date, disclaimer: 'Plan orientativo para deporte recreativo. Consulta a un profesional sanitario si tienes dudas sobre tu salud.' };
  });
}
