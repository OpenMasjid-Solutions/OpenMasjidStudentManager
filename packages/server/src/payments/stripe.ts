// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The ONE Stripe integration point (CLAUDE.md §13.1, §16 — nothing else imports the SDK). Keys are
 * fetched over the Fabric from the OS core (`GET /api/fabric/stripe?account=<STRIPE_ACCOUNT>`), which
 * returns the publishable key (→ browser), the secret key (server memory ONLY — never DB, never logs),
 * and the webhook signing secret. If the platform is unreachable or no account is configured, the
 * payment features report "temporarily unavailable" and everything else keeps working.
 */
import Stripe from 'stripe';
import { config, fabricConfigured } from '../config';
import { makeLog } from '../logger';

const log = makeLog('stripe');

interface StripeKeys {
  accountId: string;
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

let keys: StripeKeys | null = null;
let client: Stripe | null = null;

/** (Re)load the configured account's keys from the Fabric. Safe to call on boot + on settings change.
 *  Returns true on success. Never throws; never logs key material. */
export async function loadStripeKeys(): Promise<boolean> {
  if (!fabricConfigured() || !config.stripeAccount) {
    keys = null;
    client = null;
    return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${config.omosBaseUrl}/api/fabric/stripe?account=${encodeURIComponent(config.stripeAccount)}`, {
      headers: { 'X-OpenMasjid-App-Secret': config.omosAppSecret },
      signal: ctrl.signal,
      redirect: 'error',
    });
    clearTimeout(timer);
    if (!res.ok) {
      log.warn('stripe keys unavailable', { status: res.status });
      return false;
    }
    const k = (await res.json()) as { id?: string; publishableKey?: string; secretKey?: string; webhookSecret?: string };
    if (!k.secretKey || !k.publishableKey) return false;
    keys = { accountId: k.id ?? config.stripeAccount, publishableKey: k.publishableKey, secretKey: k.secretKey, webhookSecret: k.webhookSecret ?? '' };
    client = new Stripe(keys.secretKey);
    log.info('stripe keys loaded'); // never the keys themselves
    return true;
  } catch {
    return false;
  }
}

/** For tests / offline: inject keys + a client directly (never used in production). */
export function _setStripeForTest(k: { publishableKey?: string; secretKey?: string; webhookSecret?: string; accountId?: string }, c?: Stripe): void {
  keys = { accountId: k.accountId ?? 'acct_test', publishableKey: k.publishableKey ?? 'pk_test', secretKey: k.secretKey ?? 'sk_test', webhookSecret: k.webhookSecret ?? '' };
  client = c ?? new Stripe(keys.secretKey);
}

export function stripeClient(): Stripe | null {
  return client;
}
export function stripeReady(): boolean {
  return client !== null;
}
export function publishableKey(): string | null {
  return keys?.publishableKey ?? null;
}
export function webhookSecret(): string | null {
  return keys?.webhookSecret || null;
}
export function stripeAccountId(): string | null {
  return keys?.accountId ?? null;
}

/** A bare Stripe instance usable for signature verification even before keys load (constructEvent is
 *  local crypto, no API call). Prefer the real client when present. */
export function verifierStripe(): Stripe {
  return client ?? new Stripe('sk_local_verify_only');
}
