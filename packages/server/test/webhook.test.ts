// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Stripe webhook intake (CLAUDE.md §13.4) — the offline-verifiable core: a verified
 * payment_intent.succeeded for one of OUR portal intents records a payment in the ledger
 * (channel portal, idempotency = PI id); replays and other apps' events are no-ops; the route
 * verifies the Stripe signature over the raw body. (Live pay-now via Elements needs Stripe test
 * mode + the OS tunnel — this proves the money actually lands, which is what matters.)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { freshApp, makeCtx } from './harness';
import { stripeEvents, payments, paymentAllocations, invoiceItems, invoices, enrollmentFees, feePlans, enrollments, classes, terms, students, families } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let handleStripeEvent: (e: Stripe.Event) => void;
let http: FastifyInstance;
const WHSEC = 'whsec_testsecret';
const caller = (role: Role) => app.appRouter.createCaller(makeCtx({ origin: 'lan', session: { role, source: 'local', username: role, userId: `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
  const wh = await import('../src/payments/webhook');
  const st = await import('../src/payments/stripe');
  handleStripeEvent = wh.handleStripeEvent;
  st._setStripeForTest({ webhookSecret: WHSEC }); // inject a known signing secret + a client
  http = Fastify();
  http.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    (_req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : undefined);
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  wh.registerStripeWebhook(http);
  await http.ready();
});
beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [stripeEvents, paymentAllocations, payments, invoiceItems, invoices, enrollmentFees, feePlans, enrollments, classes, terms, students, families]) db.delete(t).run();
});

/** A family with a $50 open invoice; returns the familyId. */
async function seed() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Maktab A', type: 'maktab' });
  const fam = await admin.people.familyCreate({ name: 'Ismail' });
  const s = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Yusuf', lastName: 'Ismail' });
  await admin.classes.enroll({ classId: cls.id, studentId: s.id });
  const plan = await admin.billing.feePlanCreate({ name: 'Tuition', amountCents: 5000, cadence: 'monthly' });
  for (const f of await admin.billing.familyFees({ familyId: fam.id })) await admin.billing.assignFee({ enrollmentId: f.enrollmentId, feePlanId: plan.id });
  await admin.billing.generateFamily({ familyId: fam.id, periodKey: '2026-07', label: 'Tuition — Jul 2026' });
  return fam.id;
}

const piEvent = (id: string, familyId: string | null, amount: number, extra: Record<string, string> = {}): Stripe.Event =>
  ({
    id,
    type: 'payment_intent.succeeded',
    data: { object: { id: `pi_${id}`, amount, amount_received: amount, metadata: familyId ? { omos_app: 'students-portal', students_family_id: familyId, ...extra } : { ...extra } } },
  }) as unknown as Stripe.Event;

describe('handleStripeEvent → ledger', () => {
  it('records a portal payment and drops the family balance; replay is a no-op', async () => {
    const familyId = await seed();
    handleStripeEvent(piEvent('evt_1', familyId, 3000));
    const billing1 = await caller('admin').billing.familyBilling({ familyId });
    expect(billing1.balance.owedCents).toBe(2000); // 5000 − 3000
    expect(billing1.payments[0]).toMatchObject({ channel: 'portal', amountCents: 3000 });
    // Replay the SAME event id → deduped, nothing changes.
    handleStripeEvent(piEvent('evt_1', familyId, 3000));
    expect((await caller('admin').billing.familyBilling({ familyId })).balance.owedCents).toBe(2000);
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(1);
  });

  it('autopay-tagged intents record on the autopay channel', async () => {
    const familyId = await seed();
    handleStripeEvent(piEvent('evt_ap', familyId, 5000, { students_channel: 'autopay' }));
    expect((await caller('admin').billing.familyBilling({ familyId })).payments[0]).toMatchObject({ channel: 'autopay', amountCents: 5000 });
  });

  it('a webhook for an already-recorded PI (reconciliation overlap) does not double-record', async () => {
    const familyId = await seed();
    // Simulate reconciliation having already recorded the PI (payment row exists, NO stripe_events row).
    const ledger = await import('../src/billing/ledger');
    ledger.recordPayment({ familyId, amountCents: 2500, channel: 'portal', occurredAt: new Date(), idempotencyKey: 'pi_recon', memo: null }, { userId: null, role: 'reconciliation', name: 'reconciliation' });
    // Now the webhook arrives for the same PI (fresh event id → stripe_events dedupe misses).
    handleStripeEvent({ id: 'evt_recon', type: 'payment_intent.succeeded', data: { object: { id: 'pi_recon', amount: 2500, amount_received: 2500, metadata: { omos_app: 'students-portal', students_family_id: familyId } } } } as unknown as Stripe.Event);
    // Idempotent on the PI id → still exactly one payment; the event is now marked processed.
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(1);
    expect(app.dbmod.db.select().from(stripeEvents).all().map((e) => e.eventId)).toContain('evt_recon');
  });

  it('ignores events without our metadata and non-payment events', async () => {
    const familyId = await seed();
    handleStripeEvent(piEvent('evt_other', null, 9999)); // no students_family_id
    handleStripeEvent({ id: 'evt_x', type: 'customer.created', data: { object: {} } } as unknown as Stripe.Event);
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(0);
  });
});

describe('webhook route signature', () => {
  it('accepts a correctly-signed event and rejects a bad signature', async () => {
    const familyId = await seed();
    const payload = JSON.stringify(piEvent('evt_sig', familyId, 1500));
    const stripe = new Stripe('sk_test_x');
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    const good = await http.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload });
    expect(good.statusCode).toBe(200);
    expect((await caller('admin').billing.familyBilling({ familyId })).payments[0]).toMatchObject({ channel: 'portal', amountCents: 1500 });
    const bad = await http.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, payload });
    expect(bad.statusCode).toBe(400);
  });
});
