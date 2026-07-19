// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * In-process schedulers (CLAUDE.md §7, §13.3). Currently the daily autopay run; invoice
 * auto-generate and Stripe reconciliation join here in later steps. Best-effort — a failed tick
 * logs and the next tick recovers (the autopay due-date query is stateless). Started only when the
 * platform + Stripe are wired in; a standalone install schedules nothing.
 */
import { Cron } from 'croner';
import { fabricConfigured } from '../config';
import { makeLog } from '../logger';
import { runAutopay } from './autopay';

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
  log.info('schedulers started');
}
