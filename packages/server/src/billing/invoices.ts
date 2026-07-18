// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Invoice generation (CLAUDE.md §4): build a family's invoice for a period from its active
 * enrollment fees (one line per student × fee plan), then apply the family's discount as a
 * negative line. UNIQUE(family, periodKey) makes generation idempotent — re-running a period
 * never double-bills. Money is integer cents.
 */
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { invoices, invoiceItems, enrollmentFees, enrollments, students, feePlans, families } from '../db/schema';
import { rid } from '../db/ids';

/** Line items (before discount) from a family's active enrollment fees. */
function feeLines(familyId: string): { description: string; amountCents: number; studentId: string }[] {
  return db
    .select({ studentId: students.id, firstName: students.firstName, planName: feePlans.name, amountCents: feePlans.amountCents })
    .from(enrollmentFees)
    .innerJoin(enrollments, eq(enrollments.id, enrollmentFees.enrollmentId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(feePlans, eq(feePlans.id, enrollmentFees.feePlanId))
    .where(and(eq(students.familyId, familyId), eq(enrollments.status, 'active'), eq(students.status, 'active'), eq(feePlans.status, 'active')))
    .orderBy(asc(students.firstName))
    .all()
    .map((r) => ({ description: `${r.planName} — ${r.firstName}`, amountCents: r.amountCents, studentId: r.studentId }));
}

/** The family discount as a negative amount for a given subtotal (0 if none). */
function discountCents(familyId: string, subtotal: number): number {
  const fam = db.select({ kind: families.discountKind, value: families.discountValue }).from(families).where(eq(families.id, familyId)).get();
  if (!fam || fam.kind === 'none' || subtotal <= 0) return 0;
  if (fam.kind === 'percent') return -Math.min(subtotal, Math.round((subtotal * fam.value) / 10000));
  return -Math.min(subtotal, fam.value); // fixed
}

/** Generate one family's invoice for a period. Idempotent on (family, periodKey); returns the
 *  existing invoice unchanged if already generated, and skips a family with no active fees. */
export function generateForFamily(familyId: string, opts: { periodKey: string; label: string; dueDate?: string | null }): { invoiceId: string | null; created: boolean } {
  const existing = db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.familyId, familyId), eq(invoices.periodKey, opts.periodKey))).get();
  if (existing) return { invoiceId: existing.id, created: false };
  const lines = feeLines(familyId);
  if (lines.length === 0) return { invoiceId: null, created: false };
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const disc = discountCents(familyId, subtotal);
  const ts = new Date();
  const invId = rid('inv');
  db.transaction((tx) => {
    tx.insert(invoices).values({ id: invId, familyId, label: opts.label, periodKey: opts.periodKey, dueDate: opts.dueDate ?? null, status: 'open', createdAt: ts, updatedAt: ts }).run();
    for (const l of lines) tx.insert(invoiceItems).values({ id: rid('iti'), invoiceId: invId, description: l.description, amountCents: l.amountCents, studentId: l.studentId, createdAt: ts }).run();
    if (disc !== 0) tx.insert(invoiceItems).values({ id: rid('iti'), invoiceId: invId, description: 'Family discount', amountCents: disc, studentId: null, createdAt: ts }).run();
  });
  return { invoiceId: invId, created: true };
}

/** Generate invoices for every active family that has active fees. Returns how many were created. */
export function generateForPeriod(opts: { periodKey: string; label: string; dueDate?: string | null }): { created: number } {
  const fams = db.select({ id: families.id }).from(families).where(eq(families.status, 'active')).all();
  let created = 0;
  for (const f of fams) if (generateForFamily(f.id, opts).created) created++;
  return { created };
}
