// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Billing (CLAUDE.md §4/§5): fee plans, per-enrollment fee assignment, per-family discount,
 * invoice generation, the derived ledger/balance, and manual payments (cash/Zelle/check/other).
 * Admin + finance only (finance works LAN + tunnel; admin LAN-only — origin policy). All money
 * goes through billing/ledger.ts + billing/invoices.ts; amounts are integer cents. Audited.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, asc, desc } from 'drizzle-orm';
import { router, adminOrFinanceProcedure, auditActor } from './trpc';
import { db } from '../db';
import { feePlans, enrollmentFees, enrollments, students, classes, families, invoices, payments } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { recordPayment, reversePayment, familyBalance, invoiceTotal, invoicePaid } from '../billing/ledger';
import { generateForFamily, generateForPeriod } from '../billing/invoices';
import { reconcile, reconcileStatus } from '../payments/reconcile';
import { getCurrency } from '../settings';

const ID = z.string().min(1).max(64);
const NAME = z.string().trim().min(1).max(120);
const CENTS = z.number().int().min(0).max(100_000_000);
const now = () => new Date();

export const billingRouter = router({
  /** The install currency, for money formatting in the finance UI. */
  currency: adminOrFinanceProcedure.query(() => ({ currency: getCurrency() })),

  // ── Fee plans ────────────────────────────────────────────────────────────────
  feePlanList: adminOrFinanceProcedure.query(() => db.select().from(feePlans).where(eq(feePlans.status, 'active')).orderBy(asc(feePlans.name)).all()),

  feePlanCreate: adminOrFinanceProcedure.input(z.object({ name: NAME, amountCents: CENTS.min(1), cadence: z.enum(['monthly', 'per_term', 'one_time']) })).mutation(({ ctx, input }) => {
    const id = rid('fee');
    const ts = now();
    db.insert(feePlans).values({ id, name: input.name, amountCents: input.amountCents, cadence: input.cadence, status: 'active', createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'feePlan.create', { entity: 'feePlan', entityId: id, detail: { amountCents: input.amountCents, cadence: input.cadence } });
    return { id };
  }),

  feePlanArchive: adminOrFinanceProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: feePlans.id }).from(feePlans).where(eq(feePlans.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Fee plan not found.' });
    db.update(feePlans).set({ status: 'archived', updatedAt: now() }).where(eq(feePlans.id, input.id)).run();
    audit(auditActor(ctx), 'feePlan.archive', { entity: 'feePlan', entityId: input.id });
    return { ok: true as const };
  }),

  // ── Per-family fee assignment + discount ─────────────────────────────────────
  /** A family's active enrollments (student × class) with their assigned fee (if any). */
  familyFees: adminOrFinanceProcedure.input(z.object({ familyId: ID })).query(({ input }) => {
    const rows = db
      .select({ enrollmentId: enrollments.id, studentId: students.id, firstName: students.firstName, lastName: students.lastName, className: classes.name, feeId: enrollmentFees.id, feePlanId: feePlans.id, feePlanName: feePlans.name, amountCents: feePlans.amountCents })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .leftJoin(enrollmentFees, eq(enrollmentFees.enrollmentId, enrollments.id))
      .leftJoin(feePlans, eq(feePlans.id, enrollmentFees.feePlanId))
      .where(and(eq(students.familyId, input.familyId), eq(enrollments.status, 'active')))
      .orderBy(asc(students.firstName), asc(classes.name))
      .all();
    return rows;
  }),

  assignFee: adminOrFinanceProcedure.input(z.object({ enrollmentId: ID, feePlanId: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.id, input.enrollmentId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Enrollment not found.' });
    if (!db.select({ id: feePlans.id }).from(feePlans).where(eq(feePlans.id, input.feePlanId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Fee plan not found.' });
    if (db.select({ id: enrollmentFees.id }).from(enrollmentFees).where(and(eq(enrollmentFees.enrollmentId, input.enrollmentId), eq(enrollmentFees.feePlanId, input.feePlanId))).get()) return { ok: true as const };
    db.insert(enrollmentFees).values({ id: rid('enf'), enrollmentId: input.enrollmentId, feePlanId: input.feePlanId, createdAt: now() }).run();
    audit(auditActor(ctx), 'fee.assign', { entity: 'enrollment', entityId: input.enrollmentId, detail: { feePlanId: input.feePlanId } });
    return { ok: true as const };
  }),

  unassignFee: adminOrFinanceProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    db.delete(enrollmentFees).where(eq(enrollmentFees.id, input.id)).run();
    audit(auditActor(ctx), 'fee.unassign', { entity: 'enrollmentFee', entityId: input.id });
    return { ok: true as const };
  }),

  setDiscount: adminOrFinanceProcedure.input(z.object({ familyId: ID, kind: z.enum(['none', 'fixed', 'percent']), value: CENTS })).mutation(({ ctx, input }) => {
    if (!db.select({ id: families.id }).from(families).where(eq(families.id, input.familyId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Family not found.' });
    const value = input.kind === 'none' ? 0 : input.kind === 'percent' ? Math.min(input.value, 10000) : input.value;
    db.update(families).set({ discountKind: input.kind, discountValue: value, updatedAt: now() }).where(eq(families.id, input.familyId)).run();
    audit(auditActor(ctx), 'family.setDiscount', { entity: 'family', entityId: input.familyId, detail: { kind: input.kind, value } });
    return { ok: true as const };
  }),

  // ── Invoice generation ───────────────────────────────────────────────────────
  generatePeriod: adminOrFinanceProcedure.input(z.object({ periodKey: z.string().trim().min(1).max(40), label: NAME, dueDate: z.string().max(20).optional() })).mutation(({ ctx, input }) => {
    const r = generateForPeriod({ periodKey: input.periodKey, label: input.label, dueDate: input.dueDate || null });
    audit(auditActor(ctx), 'invoice.generatePeriod', { entity: 'billing', detail: { periodKey: input.periodKey, created: r.created } });
    return r;
  }),

  generateFamily: adminOrFinanceProcedure.input(z.object({ familyId: ID, periodKey: z.string().trim().min(1).max(40), label: NAME, dueDate: z.string().max(20).optional() })).mutation(({ ctx, input }) => {
    const r = generateForFamily(input.familyId, { periodKey: input.periodKey, label: input.label, dueDate: input.dueDate || null });
    audit(auditActor(ctx), 'invoice.generateFamily', { entity: 'family', entityId: input.familyId, detail: { periodKey: input.periodKey, created: r.created } });
    return r;
  }),

  voidInvoice: adminOrFinanceProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const inv = db.select({ id: invoices.id, status: invoices.status }).from(invoices).where(eq(invoices.id, input.id)).get();
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found.' });
    if (inv.status === 'void') return { ok: true as const };
    // A voided invoice drops out of the invoiced total, but its payments stay counted — voiding a
    // paid bill would understate the family balance. Reverse the payment first (§9: reversals only).
    if (invoicePaid(db, input.id) !== 0) throw new TRPCError({ code: 'CONFLICT', message: 'Reverse the payments on this invoice before voiding it.' });
    db.update(invoices).set({ status: 'void', updatedAt: now() }).where(eq(invoices.id, input.id)).run();
    audit(auditActor(ctx), 'invoice.void', { entity: 'invoice', entityId: input.id });
    return { ok: true as const };
  }),

  // ── Family ledger + payments ─────────────────────────────────────────────────
  familyBilling: adminOrFinanceProcedure.input(z.object({ familyId: ID })).query(({ input }) => {
    const fam = db.select({ discountKind: families.discountKind, discountValue: families.discountValue }).from(families).where(eq(families.id, input.familyId)).get();
    const balance = familyBalance(input.familyId);
    const invs = db.select().from(invoices).where(eq(invoices.familyId, input.familyId)).orderBy(desc(invoices.createdAt)).all().map((i) => {
      const total = invoiceTotal(db, i.id);
      const paid = invoicePaid(db, i.id);
      return { id: i.id, label: i.label, periodKey: i.periodKey, dueDate: i.dueDate, status: i.status, totalCents: total, paidCents: paid, balanceCents: total - paid };
    });
    const pays = db.select().from(payments).where(eq(payments.familyId, input.familyId)).orderBy(desc(payments.occurredAt), desc(payments.createdAt)).all().map((p) => ({ id: p.id, amountCents: p.amountCents, channel: p.channel, occurredAt: p.occurredAt, memo: p.memo, reversalOf: p.reversalOf, by: p.recordedByName }));
    return { balance, invoices: invs, payments: pays, discount: { kind: fam?.discountKind ?? 'none', value: fam?.discountValue ?? 0 } };
  }),

  /** Overview: every active family with its balance (the Billing landing list). */
  familiesOverview: adminOrFinanceProcedure.query(() => {
    const fams = db.select({ id: families.id, name: families.name }).from(families).where(eq(families.status, 'active')).orderBy(asc(families.name)).all();
    return fams.map((f) => ({ ...f, balance: familyBalance(f.id) }));
  }),

  recordManualPayment: adminOrFinanceProcedure.input(z.object({ familyId: ID, amountCents: CENTS.min(1), channel: z.enum(['cash', 'zelle', 'check', 'other']), occurredAt: z.string().max(20), memo: z.string().trim().max(200).optional() })).mutation(({ ctx, input }) => {
    if (!db.select({ id: families.id }).from(families).where(eq(families.id, input.familyId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Family not found.' });
    const res = recordPayment({ familyId: input.familyId, amountCents: input.amountCents, channel: input.channel, occurredAt: new Date(`${input.occurredAt}T12:00:00`), idempotencyKey: rid('man'), memo: input.memo || null }, auditActor(ctx));
    audit(auditActor(ctx), 'payment.record', { entity: 'family', entityId: input.familyId, detail: { channel: input.channel, amountCents: input.amountCents } });
    return res;
  }),

  reversePayment: adminOrFinanceProcedure.input(z.object({ paymentId: ID })).mutation(({ ctx, input }) => {
    const p = db.select({ id: payments.id, familyId: payments.familyId }).from(payments).where(eq(payments.id, input.paymentId)).get();
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment not found.' });
    const r = reversePayment(input.paymentId, auditActor(ctx));
    audit(auditActor(ctx), 'payment.reverse', { entity: 'family', entityId: p.familyId, detail: { paymentId: input.paymentId } });
    return r;
  }),

  // Stripe reconciliation (§11.4): the safety net for missed broker calls / webhooks. The last-run
  // summary drives the finance UI; "Reconcile now" runs a pass on demand (the scheduler runs daily).
  reconcileStatus: adminOrFinanceProcedure.query(() => reconcileStatus()),
  reconcileNow: adminOrFinanceProcedure.mutation(async ({ ctx }) => {
    const r = await reconcile(auditActor(ctx));
    audit(auditActor(ctx), 'payment.reconcile.run', { detail: { ok: r.ok, scanned: r.scanned, recorded: r.recorded } });
    return r;
  }),
});
