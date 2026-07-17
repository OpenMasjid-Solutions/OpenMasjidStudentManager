// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Grading-scale helpers (CLAUDE.md §4): the three shipped default scales (all editable) and
 * the banding function that maps a percentage to a scale's band label. Percentages are the
 * single currency the gradebook bands on; final-grade formula weighting arrives later.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { gradingScales, scaleBands } from '../db/schema';
import { rid } from '../db/ids';

/** Shipped defaults. Thresholds are sensible starting points and fully admin-editable.
 *  The madrasa band names/levels are the org defaults (CLAUDE.md §4, open question #9). */
export const DEFAULT_SCALES: { name: string; bands: { label: string; minPercent: number }[] }[] = [
  { name: 'Percentage', bands: [] },
  { name: 'A–F', bands: [
    { label: 'A', minPercent: 90 },
    { label: 'B', minPercent: 80 },
    { label: 'C', minPercent: 70 },
    { label: 'D', minPercent: 60 },
    { label: 'F', minPercent: 0 },
  ] },
  { name: 'Mumtāz–Rāsib', bands: [
    { label: 'Mumtāz', minPercent: 80 },
    { label: 'Jayyid Jiddan', minPercent: 70 },
    { label: 'Jayyid', minPercent: 60 },
    { label: 'Maqbūl', minPercent: 50 },
    { label: 'Rāsib', minPercent: 0 },
  ] },
];

/** Insert the default scales once (idempotent — a no-op if any scale already exists). */
export function seedGradingDefaults(): void {
  if (db.select({ id: gradingScales.id }).from(gradingScales).limit(1).get()) return;
  const ts = new Date();
  db.transaction((tx) => {
    for (const s of DEFAULT_SCALES) {
      const scaleId = rid('scl');
      tx.insert(gradingScales).values({ id: scaleId, name: s.name, isSystem: true, createdAt: ts, updatedAt: ts }).run();
      s.bands.forEach((b, i) => tx.insert(scaleBands).values({ id: rid('bnd'), scaleId, label: b.label, minPercent: b.minPercent, position: i, createdAt: ts }).run());
    }
  });
}

export interface Band { label: string; minPercent: number }

/** The band label for a percentage: the highest band whose minPercent it meets. Null when the
 *  scale has no bands (e.g. Percentage) or the value falls below every band. */
export function bandFor(bands: Band[], percent: number): string | null {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  for (const b of sorted) if (percent >= b.minPercent) return b.label;
  return null;
}

/** All bands for a scale (ordered), for banding + display. */
export function bandsForScale(scaleId: string): Band[] {
  return db.select({ label: scaleBands.label, minPercent: scaleBands.minPercent }).from(scaleBands).where(eq(scaleBands.scaleId, scaleId)).all();
}
