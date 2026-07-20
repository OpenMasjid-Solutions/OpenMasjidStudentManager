// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Stripe webhook endpoint auto-registration (CLAUDE.md §13.4). On boot, if we're publicly reachable
 * (OPENMASJID_PUBLIC_URL) and have Stripe access but no signing secret yet, register a webhook endpoint
 * at OUR public webhook URL and store its signing secret in the DB. Idempotent: an endpoint already at
 * our exact URL is reclaimed (deleted + recreated) so we hold a secret we can actually verify with —
 * Stripe never returns an existing endpoint's secret. Best-effort: never throws, never logs the secret.
 * The admin can also paste a signing secret manually (Settings → Payments) as the fallback.
 */
import type Stripe from 'stripe'; // type only — the client comes from stripe.ts (§16)
import { config } from '../config';
import { makeLog } from '../logger';
import { stripeClient, webhookSecret as fabricWebhookSecret } from './stripe';
import { getStripeWebhookSecret, setStripeWebhookSecret } from '../settings';

const log = makeLog('stripe-webhook');

/** The events we handle (webhook.ts) — the only ones the endpoint needs to send. */
const ENABLED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'setup_intent.succeeded', 'charge.refunded'];

/** Our public webhook URL, or '' when not exposed (no tunnel). */
export function ourWebhookUrl(): string {
  return config.omosPublicUrl ? `${config.omosPublicUrl.replace(/\/+$/, '')}/api/stripe/webhook` : '';
}

/** Ensure a usable webhook signing secret exists (§13.4). No-op when Stripe isn't configured, we're
 *  not publicly reachable, or a secret is already available (stored by us, or provided by the OS
 *  Fabric because the admin set the webhook up there). Otherwise auto-creates the endpoint. */
export async function ensureWebhookEndpoint(): Promise<void> {
  const stripe = stripeClient();
  const url = ourWebhookUrl();
  if (!stripe || !url) return; // no Stripe / not publicly reachable → reconciliation is the safety net
  if (getStripeWebhookSecret() || fabricWebhookSecret()) return; // already have a secret to verify with
  try {
    // Reclaim any endpoint already at our exact URL — we can't retrieve its secret, so delete + recreate.
    const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url === url);
    for (const e of existing) await stripe.webhookEndpoints.del(e.id);
    const ep = await stripe.webhookEndpoints.create({ url, enabled_events: ENABLED_EVENTS, description: 'OpenMasjid Students' });
    if (ep.secret) {
      setStripeWebhookSecret(ep.secret); // stored in the DB, never logged
      log.info('stripe webhook endpoint registered', { recreated: existing.length });
    }
  } catch (e) {
    // Couldn't auto-register (permissions, network) — the admin can paste a secret manually, and
    // reconciliation still records payments a missed webhook would have (§11.4). Never fatal.
    log.warn('stripe webhook endpoint auto-registration deferred', { error: (e as Error).message });
  }
}
