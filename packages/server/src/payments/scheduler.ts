// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * In-process schedulers (CLAUDE.md §7, §13.3, §11.4). The daily autopay run + the daily Stripe
 * reconciliation safety net. Best-effort — a failed tick logs and the next tick recovers (the
 * autopay due-date query and reconciliation are both stateless/idempotent). Started only when the
 * platform + Stripe are wired in; a standalone install schedules nothing.
 */
import { Cron } from 'croner';
import { fabricConfigured } from '../config';
import { makeLog } from '../logger';
import { runAutopay } from './autopay';
import { reconcile } from './reconcile';

const log = makeLog('scheduler');
let started = false;

/** ISO date (UTC) for "today". */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startSchedulers(): void {
  if (started || !fabricConfigured()) return; // standalone: nothing to schedule
  started = true;
  // Daily at 06:00 — charge every autopay-ON family whatever is due, then let the webhooks settle.
  new Cron('0 6 * * *', async () => {
    try {
      const r = await runAutopay(todayIso());
      log.info('autopay run complete', { attempted: r.attempted });
    } catch (e) {
      log.error('autopay run failed', { error: (e as Error).message });
    }
  });
  // Daily at 07:00 — reconcile against Stripe: record any succeeded tuition PI a broker call or a
  // webhook missed (incl. this morning's autopay charges), so money is never lost, only delayed (§11.4).
  new Cron('0 7 * * *', async () => {
    try {
      const r = await reconcile({ userId: null, role: 'system', name: 'reconciliation' });
      if (r.ok) log.info('reconcile run complete', { scanned: r.scanned, recorded: r.recorded });
    } catch (e) {
      log.error('reconcile run failed', { error: (e as Error).message });
    }
  });
  log.info('schedulers started');
}
