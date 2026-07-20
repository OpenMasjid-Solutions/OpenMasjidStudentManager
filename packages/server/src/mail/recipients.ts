// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Who receives a family's transactional email (§4). A family's recipients are the email addresses
 *  of all its linked guardians (via guardian_families). Used for receipts + autopay-failure notices. */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { guardians, guardianFamilies } from '../db/schema';

/** All valid guardian email addresses for a family (deduped). Empty when none is on file. */
export function guardianEmailsForFamily(familyId: string): string[] {
  const rows = db
    .select({ email: guardians.email })
    .from(guardianFamilies)
    .innerJoin(guardians, eq(guardians.id, guardianFamilies.guardianId))
    .where(eq(guardianFamilies.familyId, familyId))
    .all();
  const seen = new Set<string>();
  for (const r of rows) {
    const e = (r.email ?? '').trim();
    if (e.includes('@')) seen.add(e);
  }
  return [...seen];
}
