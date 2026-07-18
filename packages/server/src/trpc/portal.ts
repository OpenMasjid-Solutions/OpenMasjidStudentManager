// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Parent portal reads (CLAUDE.md §4, §5) — the parent-facing lens, scoped to the caller's own
 * families via guardian_users (§14: scoping in the query, never the UI). Read-only in this slice:
 * the family's kids (with their PINs — parents may see their own kids' PINs), the derived balance,
 * open invoices, and the unified payment history. Grades / schedule / merit / attendance / report
 * cards land in later slices. Every value crosses through parentProcedure (LAN + tunnel).
 */
import { and, eq, desc, inArray } from 'drizzle-orm';
import { router, parentProcedure } from './trpc';
import { db } from '../db';
import { families, students, invoices, payments } from '../db/schema';
import { familyBalance, invoiceTotal, invoicePaid } from '../billing/ledger';
import { getCurrency } from '../settings';
import { parentFamilyIds } from './familyAccess';

export const portalRouter = router({
  /** Everything the My-Family home needs, for each family this parent is linked to. */
  myFamily: parentProcedure.query(({ ctx }) => {
    const currency = getCurrency();
    const famIds = parentFamilyIds(ctx);
    if (!famIds.length) return { currency, families: [] as FamilyView[] };

    const list: FamilyView[] = famIds.map((fid) => {
      const fam = db.select({ id: families.id, name: families.name }).from(families).where(eq(families.id, fid)).get();
      const kids = db
        .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, pin: students.pin })
        .from(students)
        .where(and(eq(students.familyId, fid), eq(students.status, 'active')))
        .orderBy(students.firstName)
        .all();
      const open = db
        .select({ id: invoices.id, label: invoices.label, dueDate: invoices.dueDate, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.familyId, fid), inArray(invoices.status, ['open', 'partially_paid'])))
        .all()
        .map((i) => ({ id: i.id, label: i.label, dueDate: i.dueDate, balanceCents: invoiceTotal(db, i.id) - invoicePaid(db, i.id) }))
        .filter((i) => i.balanceCents > 0)
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
      const pays = db
        .select({ id: payments.id, amountCents: payments.amountCents, channel: payments.channel, occurredAt: payments.occurredAt, memo: payments.memo, reversalOf: payments.reversalOf })
        .from(payments)
        .where(eq(payments.familyId, fid))
        .orderBy(desc(payments.occurredAt), desc(payments.createdAt))
        .limit(25)
        .all();
      return {
        id: fid,
        name: fam?.name ?? '',
        balance: familyBalance(fid),
        students: kids,
        invoices: open,
        payments: pays,
      };
    });
    return { currency, families: list };
  }),
});

type FamilyView = {
  id: string;
  name: string;
  balance: ReturnType<typeof familyBalance>;
  students: { id: string; firstName: string; lastName: string; pin: string }[];
  invoices: { id: string; label: string; dueDate: string | null; balanceCents: number }[];
  payments: { id: string; amountCents: number; channel: string; occurredAt: Date; memo: string | null; reversalOf: string | null }[];
};
