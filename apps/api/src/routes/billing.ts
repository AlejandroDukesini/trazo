import { FEATURES, PLANS, UNAVAILABLE_FEATURES } from '@trazo/core';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { AppContext } from '../context.js';
import { HttpError, badRequest, parse, unavailable } from '../http.js';
import { getEntitlements } from '../services/entitlements.js';

function stripeClient(ctx: AppContext): Stripe | null {
  return ctx.config.STRIPE_SECRET_KEY ? new Stripe(ctx.config.STRIPE_SECRET_KEY) : null;
}

/** Precio de Stripe → plan interno. Solo los IDs configurados por entorno conceden acceso. */
function planForPrice(ctx: AppContext, priceId: string | undefined): 'plus' | null {
  if (!priceId) return null;
  const { STRIPE_PRICE_PLUS_MONTH, STRIPE_PRICE_PLUS_YEAR } = ctx.config;
  return priceId === STRIPE_PRICE_PLUS_MONTH || priceId === STRIPE_PRICE_PLUS_YEAR ? 'plus' : null;
}

/** Aplica el estado de una suscripción de Stripe (fuente de verdad: el evento firmado). */
export async function upsertStripeSubscription(ctx: AppContext, sub: Stripe.Subscription, log: FastifyInstance['log']) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  let userId = sub.metadata?.userId ?? null;
  if (!userId) {
    const c = await ctx.db.selectFrom('billing_customers').select('user_id').where('stripe_customer_id', '=', customerId).executeTakeFirst();
    userId = c?.user_id ?? null;
  }
  if (!userId) {
    log.warn({ sub: sub.id }, 'Suscripción de Stripe sin usuario asociado; se ignora');
    return;
  }
  const exists = await ctx.db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst();
  if (!exists) return;
  const item = sub.items.data[0];
  const plan = planForPrice(ctx, item?.price.id);
  if (!plan) {
    log.warn({ sub: sub.id, price: item?.price.id }, 'Precio de Stripe no reconocido; no concede acceso');
    return;
  }
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  await ctx.db
    .insertInto('subscriptions')
    .values({ user_id: userId, provider: 'stripe', provider_ref: sub.id, plan, status: sub.status, current_period_end: periodEnd, cancel_at_period_end: sub.cancel_at_period_end })
    .onConflict((oc) =>
      oc.columns(['provider', 'provider_ref']).doUpdateSet({ status: sub.status, plan, current_period_end: periodEnd, cancel_at_period_end: sub.cancel_at_period_end, updated_at: new Date() }),
    )
    .execute();
  await ctx.db.insertInto('billing_customers').values({ user_id: userId, stripe_customer_id: customerId }).onConflict((oc) => oc.column('user_id').doUpdateSet({ stripe_customer_id: customerId })).execute();
}

export async function billingRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const { db } = ctx;

  app.get('/billing/plans', async () => ({
    plans: Object.values(PLANS).map((p) => ({ key: p.key, name: p.name, tagline: p.tagline, features: p.features, limits: p.limits })),
    features: FEATURES,
    unavailable: UNAVAILABLE_FEATURES,
    providers: {
      stripe: !!(ctx.config.STRIPE_SECRET_KEY && (ctx.config.STRIPE_PRICE_PLUS_MONTH || ctx.config.STRIPE_PRICE_PLUS_YEAR)),
      googlePlay: false,
    },
    intervals: { month: !!ctx.config.STRIPE_PRICE_PLUS_MONTH, year: !!ctx.config.STRIPE_PRICE_PLUS_YEAR },
  }));

  app.get('/billing/subscription', async (req) => {
    const user = requireUser(req);
    const subs = await db.selectFrom('subscriptions').select(['provider', 'plan', 'status', 'current_period_end', 'cancel_at_period_end', 'updated_at']).where('user_id', '=', user.id).orderBy('updated_at', 'desc').execute();
    return {
      entitlements: await getEntitlements(ctx, user.id),
      subscriptions: subs.map((s) => ({ provider: s.provider, plan: s.plan, status: s.status, currentPeriodEnd: s.current_period_end?.toISOString() ?? null, cancelAtPeriodEnd: s.cancel_at_period_end })),
    };
  });

  app.post('/billing/checkout', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = requireUser(req);
    const stripe = stripeClient(ctx);
    const { interval } = parse(z.object({ interval: z.enum(['month', 'year']) }), req.body);
    const price = interval === 'month' ? ctx.config.STRIPE_PRICE_PLUS_MONTH : ctx.config.STRIPE_PRICE_PLUS_YEAR;
    if (!stripe || !price) throw unavailable('billing_unavailable', 'Los pagos no están configurados en este servidor.');
    const ent = await getEntitlements(ctx, user.id);
    if (ent.plan !== 'free') throw badRequest('already_subscribed', 'Ya tienes una suscripción activa.');
    const u = await db.selectFrom('users').select(['email']).where('id', '=', user.id).executeTakeFirstOrThrow();
    let customer = (await db.selectFrom('billing_customers').select('stripe_customer_id').where('user_id', '=', user.id).executeTakeFirst())?.stripe_customer_id;
    if (!customer) {
      customer = (await stripe.customers.create({ email: u.email, metadata: { userId: user.id } }, { idempotencyKey: `customer-${user.id}` })).id;
      await db.insertInto('billing_customers').values({ user_id: user.id, stripe_customer_id: customer }).onConflict((oc) => oc.column('user_id').doUpdateSet({ stripe_customer_id: customer! })).execute();
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${ctx.config.APP_URL}/ajustes/suscripcion?estado=procesando`,
      cancel_url: `${ctx.config.APP_URL}/ajustes/suscripcion?estado=cancelado`,
      allow_promotion_codes: true,
    });
    return { url: session.url };
  });

  app.post('/billing/portal', async (req) => {
    const user = requireUser(req);
    const stripe = stripeClient(ctx);
    if (!stripe) throw unavailable('billing_unavailable', 'Los pagos no están configurados en este servidor.');
    const c = await db.selectFrom('billing_customers').select('stripe_customer_id').where('user_id', '=', user.id).executeTakeFirst();
    if (!c?.stripe_customer_id) throw badRequest('no_customer', 'No tienes suscripciones gestionadas por la web.');
    const s = await stripe.billingPortal.sessions.create({ customer: c.stripe_customer_id, return_url: `${ctx.config.APP_URL}/ajustes/suscripcion` });
    return { url: s.url };
  });

  /**
   * Google Play Billing: la verificación exige la Google Play Developer API con una cuenta de servicio.
   * Mientras no esté configurada se responde 503: nunca se conceden derechos sin verificar.
   */
  app.post('/billing/google/verify', async (req) => {
    requireUser(req);
    throw unavailable('google_play_unavailable', 'La verificación de compras de Google Play aún no está configurada.');
  });

  /** Webhook de Stripe: cuerpo crudo, firma verificada e idempotencia por id de evento. */
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/billing/webhooks/stripe', { config: { rateLimit: false } }, async (req, reply) => {
      const secret = ctx.config.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw unavailable('billing_unavailable', 'Webhook no configurado.');
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') throw badRequest('missing_signature', 'Falta la firma.');
      let event: Stripe.Event;
      try {
        // constructEvent solo verifica la firma (HMAC); no realiza llamadas de red.
        event = new Stripe(ctx.config.STRIPE_SECRET_KEY ?? 'sk_unused').webhooks.constructEvent(req.body as Buffer, sig, secret);
      } catch {
        throw new HttpError(400, 'invalid_signature', 'Firma no válida.');
      }
      const processed = await db.transaction().execute(async (trx) => {
        const ins = await trx
          .insertInto('billing_events')
          .values({ provider: 'stripe', event_id: event.id, type: event.type })
          .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
          .executeTakeFirst();
        if (!Number(ins.numInsertedOrUpdatedRows ?? 0)) return false; // duplicado: ya procesado
        const tctx = { ...ctx, db: trx };
        switch (event.type) {
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
          case 'customer.subscription.paused':
          case 'customer.subscription.resumed':
            await upsertStripeSubscription(tctx, event.data.object as Stripe.Subscription, req.log);
            break;
          case 'checkout.session.completed': {
            const s = event.data.object as Stripe.Checkout.Session;
            const customer = typeof s.customer === 'string' ? s.customer : s.customer?.id;
            if (s.client_reference_id && customer) {
              await trx.insertInto('billing_customers').values({ user_id: s.client_reference_id, stripe_customer_id: customer })
                .onConflict((oc) => oc.column('user_id').doUpdateSet({ stripe_customer_id: customer })).execute();
            }
            break;
          }
          default:
            break;
        }
        return true;
      });
      reply.code(200);
      return { received: true, duplicate: !processed };
    });
  });
}
