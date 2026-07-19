// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Stripe reconciliation (CLAUDE.md §11.4) — the safety net. A daily job + an on-demand "Reconcile
 * now" button (finance) list every SUCCEEDED PaymentIntent tagged `metadata.purpose ==
 * "students-billing"` since the last cursor and record any whose PI id isn't already an idempotency
 * key, flagged `via: reconciliation`. This covers BOTH a missed broker call from Donations/Kiosk
 * AND a missed webhook for our own portal/autopay intents — so money is never lost, only delayed.
 *
 * Recording goes through the ONE ledger path (idempotency key = the PI id), so a reconcile that
 * overlaps a late webhook, or a re-run over the same window, is a harmless no-op. Recording an
 * autopay PI here also resolves a stuck-'pending' autopay run (a success whose webhook was lost).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { payments } from '../db/schema';
import type { PaymentChannel } from '../db/schema';
import { recordPayment } from '../billing/ledger';
import { onAutopaySucceeded } from './autopay';
import { stripeClient, loadStripeKeys } from './stripe';
import { getSetting, setSetting, SETTING_KEYS } from '../settings';
import { audit, type AuditActor } from '../audit';
import { notifyPlatform } from '../fabric/platform';
import { makeLog } from '../logger';

const log = makeLog('reconcile');

/** First-run look-back when no cursor is stored yet (seconds) — a month of history to catch up. */
const FIRST_RUN_LOOKBACK_SEC = 35 * 24 * 60 * 60;

export interface ReconcileResult {
  ok: boolean; // false only when Stripe isn't configured (nothing to do)
  scanned: number;
  recorded: number;
  ranAt: string;
}

/** Map a students-billing PI's metadata (§11.3) to our ledger channel. Returns null for an
 *  unrecognized origin — we only record what we can attribute. */
function channelFor(md: Record<string, string>): PaymentChannel | null {
  switch (md.omos_app) {
    case 'donations':
      return 'donations-web';
    case 'kiosk':
      return 'kiosk';
    case 'students-portal':
      return md.students_channel === 'autopay' ? 'autopay' : 'portal';
    default:
      return null;
  }
}

function alreadyRecorded(piId: string): boolean {
  return !!db.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, piId)).get();
}

/** Run one reconciliation pass. Safe to call concurrently with the webhook and to re-run. */
export async function reconcile(actor: AuditActor): Promise<ReconcileResult> {
  const ranAt = new Date().toISOString();
  let stripe = stripeClient();
  if (!stripe) {
    await loadStripeKeys();
    stripe = stripeClient();
  }
  if (!stripe) {
    log.info('reconcile skipped — Stripe not configured');
    return { ok: false, scanned: 0, recorded: 0, ranAt };
  }

  const nowSec = Math.floor(Date.parse(ranAt) / 1000);
  const cursor = Number(getSetting(SETTING_KEYS.reconcileCursor)) || nowSec - FIRST_RUN_LOOKBACK_SEC;
  // Re-scan a 1-second overlap so a PI created in the cursor's exact second is never skipped
  // (Stripe search has no >= operator); the ledger's PI-id idempotency makes the overlap a no-op.
  const since = Math.max(0, cursor - 1);
  const query = `status:"succeeded" AND metadata["purpose"]:"students-billing" AND created>${since}`;

  let scanned = 0;
  let recorded = 0;
  let maxCreated = cursor;
  // The earliest created-time of a PI we scanned but could NOT durably record (a transient record
  // throw — e.g. a DB write error, or a family row that isn't there yet). The persisted cursor is
  // capped strictly below this so the PI is re-scanned next run and never silently skipped — money is
  // never lost (recording stays idempotent, so the re-scan is a no-op once it succeeds). Unattributable
  // PIs (no family / unknown origin) are TERMINAL — they can never be recorded, so they don't hold the
  // cursor back (that would wedge the scan forever); we surface them in the log for manual handling.
  let earliestErrored = Infinity;
  let page: string | undefined;
  try {
    for (;;) {
      const res = await stripe.paymentIntents.search({ query, limit: 100, ...(page ? { page } : {}) });
      for (const pi of res.data) {
        scanned++;
        if (pi.created > maxCreated) maxCreated = pi.created;
        const md = (pi.metadata ?? {}) as Record<string, string>;
        if (alreadyRecorded(pi.id)) {
          // Already captured (a broker call or the webhook) — but an autopay run can still be stuck
          // 'pending' if the success path crashed after the ledger write but before resolving the run
          // and the webhook was also lost. Heal it here (idempotent) so chargeFamily's pending-run
          // guard doesn't silently block the family's future charges. Mirrors the webhook (§13.4).
          if (channelFor(md) === 'autopay') onAutopaySucceeded(pi.id, md.students_autopay_run_id);
          continue;
        }
        const familyId = md.students_family_id;
        const channel = channelFor(md);
        const amount = pi.amount_received || pi.amount || 0;
        if (!familyId || !channel || amount <= 0) {
          // A succeeded tuition PI we can't attribute (missing family id / unknown origin). It can
          // never be recorded, so let the cursor pass it — but surface it so finance can reconcile
          // by hand rather than have it silently retried forever (no PII: the PI id + app only).
          log.warn('reconcile: unattributable tuition PI skipped', { pi: pi.id, omosApp: md.omos_app || null });
          continue;
        }
        try {
          const r = recordPayment(
            {
              familyId,
              amountCents: amount,
              channel,
              occurredAt: new Date(pi.created * 1000),
              idempotencyKey: pi.id,
              memo: null,
              externalRef: { stripePaymentIntentId: pi.id, stripeChargeId: (pi.latest_charge as string) ?? null, via: 'reconciliation' },
            },
            { userId: null, role: channel, name: 'reconciliation' },
          );
          if (!r.duplicate) {
            recorded++;
            // A recovered autopay success resolves its stuck-'pending' run + resets the retry ladder.
            if (channel === 'autopay') onAutopaySucceeded(pi.id, md.students_autopay_run_id);
            audit(actor, 'payment.reconcile', { entity: 'family', entityId: familyId, detail: { channel, amountCents: amount, stripePaymentIntentId: pi.id } });
            void notifyPlatform(`A previously-missed tuition payment of ${(amount / 100).toFixed(2)} was recorded (${channel}).`, { title: 'Tuition payment recovered' });
          }
        } catch (e) {
          // A transient write failure on ONE PI must not abort the pass — but must NOT let the cursor
          // pass it either. Hold the cursor below it so the next run retries it (idempotent).
          if (pi.created < earliestErrored) earliestErrored = pi.created;
          log.warn('reconcile record failed — will retry next run', { pi: pi.id, error: (e as Error).message });
        }
      }
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
  } catch (e) {
    // Stripe unreachable / search error: keep whatever we recorded, do NOT advance the cursor, and
    // let the next run retry the same window (recording stays idempotent).
    log.error('reconcile scan failed', { error: (e as Error).message });
    return { ok: true, scanned, recorded, ranAt };
  }

  // Never advance the cursor to/past a PI that errored on record — cap it strictly below the earliest
  // such PI so it is re-scanned next run (money is never silently skipped, §11.4).
  const nextCursor = earliestErrored === Infinity ? maxCreated : Math.min(maxCreated, earliestErrored - 1);
  setSetting(SETTING_KEYS.reconcileCursor, String(nextCursor));
  setSetting(SETTING_KEYS.reconcileLast, JSON.stringify({ ranAt, scanned, recorded }));
  log.info('reconcile complete', { scanned, recorded });
  return { ok: true, scanned, recorded, ranAt };
}

/** The last reconcile run's summary, for the finance UI (null before the first run). */
export function reconcileStatus(): { ranAt: string; scanned: number; recorded: number } | null {
  const raw = getSetting(SETTING_KEYS.reconcileLast);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { ranAt: string; scanned: number; recorded: number };
  } catch {
    return null;
  }
}
