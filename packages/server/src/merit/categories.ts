// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Merit-category defaults (CLAUDE.md §4). Shipped, fully editable, seeded once on first boot.
 * Names are madrasa-native defaults (open question #9) and go through i18n as display strings;
 * the code only knows "merit category".
 */
import { meritCategories } from '../db/schema';
import { db } from '../db';
import { rid } from '../db/ids';

export const DEFAULT_MERIT_CATEGORIES: { name: string; defaultPoints: number }[] = [
  { name: 'Ādāb', defaultPoints: 5 },
  { name: 'Sunnah practice', defaultPoints: 5 },
  { name: 'Hifz milestone', defaultPoints: 10 },
  { name: 'Helping others', defaultPoints: 5 },
];

/** Insert the default merit categories once (idempotent — a no-op if any category exists). */
export function seedMeritDefaults(): void {
  if (db.select({ id: meritCategories.id }).from(meritCategories).limit(1).get()) return;
  const ts = new Date();
  db.transaction((tx) => {
    DEFAULT_MERIT_CATEGORIES.forEach((c, i) => tx.insert(meritCategories).values({ id: rid('mct'), name: c.name, defaultPoints: c.defaultPoints, isSystem: true, position: i, createdAt: ts, updatedAt: ts }).run());
  });
}
