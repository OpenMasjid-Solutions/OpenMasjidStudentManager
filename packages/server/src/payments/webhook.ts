// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Stripe webhook intake (CLAUDE.md §13.4). Route: POST /api/stripe/webhook at OPENMASJID_PUBLIC_URL
 * — signature-verified over the RAW body, event-deduped via `stripe_events`, then dispatched. The
 * ledger is the source of truth: a `payment_intent.succeeded` for one of OUR portal/autopay intents
 * records a payment (idempotency key = the PaymentIntent id). Unknown events are acknowledged (200)
 * and ignored. We defensively only act on `metadata.omos_app === 'students-portal'` — the OS routes
 * only our events here, but Donations/Kiosk keep their own webhooks, so we never touch theirs.
 */
import type Stripe from 'stripe';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { stripeEvents } from '../db/schema';
import type { PaymentChannel } from '../db/schema';
import { recordPayment } from '../billing/ledger';
import { makeLog } from '../logger';
import { notifyPlatform } from '../fabric/platform';
import { verifierStripe, webhookSecret } from './stripe';
import { onAutopaySucceeded, onAutopayFailed } from './autopay';

const log = makeLog('stripe-webhook');

/** Process a verified Stripe event. Idempotent: a duplicate event id (Stripe re-delivery) is a
 *  no-op, and the ledger is itself idempotent on the PaymentIntent id. Exported for direct testing. */
export function handleStripeEvent(event: Stripe.Event): void {
  if (db.select({ id: stripeEvents.eventId }).from(stripeEvents).where(eq(stripeEvents.eventId, event.id)).get()) return; // already processed

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const md = (pi.metadata ?? {}) as Record<string, string>;
      // Only OUR portal/autopay intents. (Donations/Kiosk record via the Fabric broker, not here.)
      if (md.omos_app === 'students-portal' && md.students_family_id) {
        // autopay intents are tagged; everything else from the portal is a manual pay-now.
        const channel: PaymentChannel = md.students_channel === 'autopay' ? 'autopay' : 'portal';
        const amount = pi.amount_received || pi.amount || 0;
        try {
          const res = recordPayment(
            {
              familyId: md.students_family_id,
              amountCents: amount,
              channel,
              occurredAt: new Date(),
              idempotencyKey: pi.id, // the PI id — a re-delivery / reconciliation hit is a no-op
              memo: null,
              externalRef: { stripePaymentIntentId: pi.id, stripeChargeId: (pi.latest_charge as string) ?? null },
            },
            { userId: null, role: channel, name: channel },
          );
          // Only notify on a genuinely-new payment — a re-delivery or reconciliation overlap (payment
          // already recorded via the PI-id idempotency key) must not re-alert finance.
          if (!res.duplicate) void notifyPlatform(`A tuition payment of ${(amount / 100).toFixed(2)} was received (${channel}).`, { title: 'Tuition payment' });
        } catch (e) {
          // A bad allocation etc. shouldn't 500 the webhook (Stripe would retry forever). Log + ack.
          log.error('payment_intent.succeeded → ledger failed', { pi: pi.id, error: (e as Error).message });
        }
        if (channel === 'autopay') onAutopaySucceeded(pi.id, md.students_autopay_run_id); // mark run charged + reset ladder (resolve by our run id — robust if the PI id was never persisted)
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const md = (pi.metadata ?? {}) as Record<string, string>;
      if (md.omos_app === 'students-portal' && md.students_channel === 'autopay') onAutopayFailed(pi.id, md.students_autopay_run_id); // advance the ladder (resolve by our run id)
      break;
    }
    // setup_intent.succeeded (saved cards) is handled by the client → portal.saveCard path; charge.refunded
    // lands with refunds (later). Acknowledge everything else.
    default:
      break;
  }

  db.insert(stripeEvents).values({ eventId: event.id, type: event.type, createdAt: new Date() }).run();
}

export function registerStripeWebhook(app: FastifyInstance): void {
  app.post('/api/stripe/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const secret = webhookSecret();
    const sig = req.headers['stripe-signature'];
    const raw = (req as unknown as { rawBody?: string }).rawBody;
    if (!secret || !sig || typeof raw !== 'string') {
      // No signing secret configured (Stripe not wired) or no signature → reject; reconciliation (§11.4)
      // is the safety net that records anything a missed webhook would have.
      return reply.code(400).send({ error: 'Webhook not verifiable.' });
    }
    let event: Stripe.Event;
    try {
      event = verifierStripe().webhooks.constructEvent(raw, Array.isArray(sig) ? sig[0] : sig, secret);
    } catch {
      return reply.code(400).send({ error: 'Bad signature.' });
    }
    try {
      handleStripeEvent(event);
    } catch (e) {
      log.error('webhook handler error', { type: event.type, error: (e as Error).message });
      // Still 200 — we've verified the event; a handler bug shouldn't wedge Stripe into endless retries.
    }
    return reply.send({ received: true });
  });
}
