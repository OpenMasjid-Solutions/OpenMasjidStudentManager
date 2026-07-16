// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Student PINs (§9, §11.2, §14). 6-digit, CSPRNG, UNIQUE per install — the lookup index
 * for name+PIN payments and one door into portal self-registration. Low entropy on
 * purpose (parents type them), so they are compensated elsewhere with per-PIN lockout
 * (a later slice). NEVER logged, never in URLs / Stripe metadata / emails.
 */
import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { students } from '../db/schema';

/** A uniform 6-digit string, e.g. "042913". */
export function random6(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** A PIN not currently used by any student on this install. Retries on collision; the
 *  space is ~1e6 so for a real madrasa this practically never loops. */
export function generateUniquePin(): string {
  for (let i = 0; i < 100; i++) {
    const pin = random6();
    const clash = db.select({ id: students.id }).from(students).where(eq(students.pin, pin)).get();
    if (!clash) return pin;
  }
  throw new Error('could not allocate a unique student PIN');
}
