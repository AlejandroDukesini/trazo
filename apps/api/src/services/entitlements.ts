import { entitlementsFor, hasFeature, type Entitlements, type Feature, type PlanKey } from '@trazo/core';
import { sql } from 'kysely';
import type { AppContext } from '../context.js';
import { premiumRequired } from '../http.js';

/** Estados de suscripción que otorgan acceso. `past_due` no: el pago ha fallado. */
export const ACTIVE_STATUSES = ['active', 'trialing'];

/** Derechos calculados SIEMPRE en servidor a partir de las suscripciones verificadas. */
export async function getEntitlements(ctx: AppContext, userId: string): Promise<Entitlements> {
  const sub = await ctx.db
    .selectFrom('subscriptions')
    .select(['plan', 'current_period_end'])
    .where('user_id', '=', userId)
    .where('status', 'in', ACTIVE_STATUSES)
    .where((eb) => eb.or([eb('current_period_end', 'is', null), eb('current_period_end', '>', sql<Date>`now()`)]))
    .orderBy('current_period_end', 'desc')
    .executeTakeFirst();
  if (!sub || !(sub.plan in { plus: 1 })) return entitlementsFor('free');
  return entitlementsFor(sub.plan as PlanKey, sub.current_period_end?.toISOString() ?? null);
}

export async function requireFeature(ctx: AppContext, userId: string, feature: Feature): Promise<Entitlements> {
  const e = await getEntitlements(ctx, userId);
  if (!hasFeature(e, feature)) throw premiumRequired(feature);
  return e;
}
