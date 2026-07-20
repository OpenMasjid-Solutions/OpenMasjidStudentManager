// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Parent portal reads (CLAUDE.md §4, §5) — the parent-facing lens, scoped to the caller's own
 * families via guardian_users (§14: scoping in the query, never the UI). Read-only in this slice:
 * the family's kids (with their PINs — parents may see their own kids' PINs), the derived balance,
 * open invoices, and the unified payment history. Grades / schedule / merit / attendance / report
 * cards land in later slices. Every value crosses through parentProcedure (LAN + tunnel).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, asc, desc, inArray } from 'drizzle-orm';
import { router, parentProcedure } from './trpc';
import { db } from '../db';
import { families, students, invoices, payments, reportCards, transcripts, classes, classSessions, enrollments, gradeItems, grades, attendance, meritAwards, meritCategories, paymentMethods, autopayEnrollments } from '../db/schema';
import { familyBalance, invoiceTotal, invoicePaid, recordPayment } from '../billing/ledger';
import { formatMoney } from '../db/money';
import { getCurrency } from '../settings';
import { parentFamilyIds, parentStudentIds, assertStudentAccess, assertFamilyAccess } from './familyAccess';
import { stripeClient, stripeReady, publishableKey } from '../payments/stripe';
import { notifyPlatform } from '../fabric/platform';
import { sendReceipt } from '../mail/notify';
import { makeLog } from '../logger';

const payLog = makeLog('portal');

const STUDENT = z.object({ studentId: z.string().min(1).max(64) });

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

  /** Published report cards + transcripts for the parent's kids (the documents families keep, §15).
   *  PUBLISHED-only and own-kids-only — the PDFs themselves are served by the authed /reports route,
   *  which re-checks the same wall. For report cards we surface the latest published version per class. */
  myReports: parentProcedure.query(({ ctx }) => {
    const kidIds = parentStudentIds(ctx);
    if (!kidIds.length) return { children: [] as ReportChild[] };

    const kids = db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName }).from(students).where(inArray(students.id, kidIds)).orderBy(students.firstName).all();

    const children: ReportChild[] = kids.map((k) => {
      // Report cards: published only; keep the highest-version published card per class.
      const cards = db
        .select({ id: reportCards.id, classId: reportCards.classId, version: reportCards.version, generatedAt: reportCards.generatedAt, publishedAt: reportCards.publishedAt })
        .from(reportCards)
        .where(and(eq(reportCards.studentId, k.id)))
        .orderBy(desc(reportCards.version))
        .all()
        .filter((c) => c.publishedAt != null);
      const latestPerClass = new Map<string, (typeof cards)[number]>();
      for (const c of cards) if (!latestPerClass.has(c.classId)) latestPerClass.set(c.classId, c); // first = highest version
      const classNames = new Map(db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, [...latestPerClass.keys(), '__none__'])).all().map((r) => [r.id, r.name]));
      const reportCardList = [...latestPerClass.values()].map((c) => ({ id: c.id, className: classNames.get(c.classId) ?? '—', version: c.version, generatedAt: c.generatedAt }));

      // Transcripts: published only; latest published version.
      const trs = db
        .select({ id: transcripts.id, version: transcripts.version, generatedAt: transcripts.generatedAt, publishedAt: transcripts.publishedAt })
        .from(transcripts)
        .where(eq(transcripts.studentId, k.id))
        .orderBy(desc(transcripts.version))
        .all()
        .filter((tr) => tr.publishedAt != null);
      const transcriptList = trs.length ? [{ id: trs[0].id, version: trs[0].version, generatedAt: trs[0].generatedAt }] : [];

      return { studentId: k.id, name: `${k.firstName} ${k.lastName}`.trim(), reportCards: reportCardList, transcripts: transcriptList };
    });
    return { children };
  }),

  /** One of the parent's kids: gradebook items + the kid's score, grouped by class. Read-only. */
  childGrades: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const enrs = db
      .select({ classId: enrollments.classId, className: classes.name })
      .from(enrollments)
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active')))
      .orderBy(asc(classes.name))
      .all();
    // The kid's scores (points are stored ×100 to avoid float drift).
    const scoreOf = new Map(db.select({ gradeItemId: grades.gradeItemId, points: grades.points }).from(grades).where(eq(grades.studentId, input.studentId)).all().map((g) => [g.gradeItemId, g.points]));
    const classesOut = enrs.map((e) => {
      const items = db
        .select({ id: gradeItems.id, title: gradeItems.title, date: gradeItems.date, maxPoints: gradeItems.maxPoints, category: gradeItems.category })
        .from(gradeItems)
        .where(eq(gradeItems.classId, e.classId))
        .orderBy(asc(gradeItems.createdAt))
        .all();
      return {
        classId: e.classId,
        className: e.className,
        items: items.map((it) => ({ title: it.title, date: it.date, maxPoints: it.maxPoints, category: it.category, points: scoreOf.has(it.id) ? scoreOf.get(it.id)! / 100 : null })),
      };
    });
    return { classes: classesOut };
  }),

  /** One of the parent's kids: attendance tallies + recent records. Read-only. */
  childAttendance: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const rows = db.select({ date: attendance.date, status: attendance.status, classId: attendance.classId }).from(attendance).where(eq(attendance.studentId, input.studentId)).orderBy(desc(attendance.date)).all();
    const counts = { present: 0, absent: 0, late: 0, excused: 0 } as Record<'present' | 'absent' | 'late' | 'excused', number>;
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const classIds = [...new Set(rows.map((r) => r.classId))];
    const classNames = classIds.length ? new Map(db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds)).all().map((c) => [c.id, c.name])) : new Map<string, string>();
    const recent = rows.slice(0, 20).map((r) => ({ date: r.date, status: r.status, className: classNames.get(r.classId) ?? '—' }));
    return { counts, total: rows.length, recent };
  }),

  /** One of the parent's kids: merit total + award history. Read-only. */
  childMerit: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const awards = db.select({ points: meritAwards.points, categoryId: meritAwards.categoryId, note: meritAwards.note, at: meritAwards.createdAt }).from(meritAwards).where(eq(meritAwards.studentId, input.studentId)).orderBy(desc(meritAwards.createdAt)).all();
    const total = awards.reduce((s, a) => s + a.points, 0);
    const catNames = new Map(db.select({ id: meritCategories.id, name: meritCategories.name }).from(meritCategories).all().map((c) => [c.id, c.name]));
    const history = awards.map((a) => ({ points: a.points, category: catNames.get(a.categoryId) ?? '—', note: a.note, at: a.at }));
    return { total, history };
  }),

  /** Whether card payments are available + the publishable key for Stripe Elements (§13.1/§13.2). */
  payConfig: parentProcedure.query(() => ({ ready: stripeReady(), publishableKey: publishableKey(), currency: getCurrency() })),

  /** Create a PaymentIntent for a chosen amount against one of the parent's families (§13.2). Card
   *  data never touches our server — the browser confirms with Elements, then calls confirmPayment
   *  (below) which records it. This just mints the intent against the admin-chosen Stripe account. */
  createPayment: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64), amountCents: z.number().int().min(100).max(100_000_000) })).mutation(async ({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    const stripe = stripeClient();
    if (!stripe) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Card payments are temporarily unavailable.' });
    const fam = db.select({ id: families.id, name: families.name, stripeCustomerId: families.stripeCustomerId }).from(families).where(eq(families.id, input.familyId)).get();
    if (!fam) throw new TRPCError({ code: 'NOT_FOUND', message: 'Family not found.' });

    try {
      let customerId = fam.stripeCustomerId;
      if (!customerId) {
        const c = await stripe.customers.create({ name: fam.name, metadata: { students_family_id: fam.id } });
        customerId = c.id;
        db.update(families).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(families.id, fam.id)).run();
      }
      const pi = await stripe.paymentIntents.create({
        amount: input.amountCents,
        currency: getCurrency(),
        customer: customerId,
        description: `School balance — ${fam.name}`,
        // §11.3 metadata — the webhook keys off these. NEVER the PIN or a typed name.
        metadata: { purpose: 'students-billing', omos_app: 'students-portal', students_family_id: fam.id, students_channel: 'portal' },
        automatic_payment_methods: { enabled: true },
      });
      return { clientSecret: pi.client_secret, publishableKey: publishableKey() };
    } catch (e) {
      // Never surface a raw Stripe/DB message to the parent (§15/§18) — log ids only, return one warm line.
      payLog.error('createPayment failed', { familyId: fam.id, error: (e as Error).message });
      throw new TRPCError({ code: 'BAD_GATEWAY', message: 'We couldn’t start your payment just now. Please try again in a moment.' });
    }
  }),

  /** Confirm a portal pay-now on return (§13.2 — NO webhook): retrieve the PI from Stripe, verify it's
   *  OURS and belongs to THIS family, and record it to the ledger if it succeeded. Idempotent
   *  (idempotency key = the PI id); the daily reconciliation (§11.4) is the backstop if the browser
   *  never calls this (e.g. the tab was closed). */
  confirmPayment: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64), paymentIntentId: z.string().min(1).max(255) })).mutation(async ({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    const stripe = stripeClient();
    if (!stripe) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Card payments are temporarily unavailable.' });
    let pi: import('stripe').Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(input.paymentIntentId);
    } catch (e) {
      payLog.error('confirmPayment retrieve failed', { familyId: input.familyId, error: (e as Error).message });
      throw new TRPCError({ code: 'BAD_GATEWAY', message: 'We couldn’t confirm your payment just now — it’ll appear on your account shortly.' });
    }
    const md = (pi.metadata ?? {}) as Record<string, string>;
    // Must be OUR portal intent for THIS family — a parent can never confirm another family's PI (§14).
    if (md.purpose !== 'students-billing' || md.omos_app !== 'students-portal' || md.students_family_id !== input.familyId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment not found.' });
    }
    const succeeded = pi.status === 'succeeded';
    if (succeeded) {
      const amount = pi.amount_received || pi.amount || 0;
      const res = recordPayment(
        { familyId: input.familyId, amountCents: amount, channel: 'portal', occurredAt: new Date(), idempotencyKey: pi.id, memo: null, externalRef: { stripePaymentIntentId: pi.id, stripeChargeId: (pi.latest_charge as string) ?? null } },
        { userId: ctx.session.userId ?? null, role: 'portal', name: 'portal' },
      );
      if (!res.duplicate) {
        void notifyPlatform(`A tuition payment of ${(amount / 100).toFixed(2)} was received (portal).`, { title: 'Tuition payment' });
        void sendReceipt(input.familyId, formatMoney(amount, getCurrency())); // §13.2.5 — "payment", never "donation"
      }
    }
    return { status: pi.status, recorded: succeeded };
  }),

  /** Saved cards + autopay state for a family (§13.3). */
  autopayStatus: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64) })).query(({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    const enr = db.select().from(autopayEnrollments).where(eq(autopayEnrollments.familyId, input.familyId)).get();
    const cards = db.select({ id: paymentMethods.id, brand: paymentMethods.brand, last4: paymentMethods.last4, expMonth: paymentMethods.expMonth, expYear: paymentMethods.expYear, isDefault: paymentMethods.isDefault }).from(paymentMethods).where(eq(paymentMethods.familyId, input.familyId)).all();
    return { ready: stripeReady(), enabled: !!enr?.enabled, defaultPmId: enr?.defaultPmId ?? null, cards };
  }),

  /** Start saving a card: a SetupIntent (off-session capable) the browser confirms with Elements. */
  createSetupIntent: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    const stripe = stripeClient();
    if (!stripe) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Card payments are temporarily unavailable.' });
    const fam = db.select({ id: families.id, name: families.name, stripeCustomerId: families.stripeCustomerId }).from(families).where(eq(families.id, input.familyId)).get();
    if (!fam) throw new TRPCError({ code: 'NOT_FOUND', message: 'Family not found.' });
    try {
      let customerId = fam.stripeCustomerId;
      if (!customerId) {
        const c = await stripe.customers.create({ name: fam.name, metadata: { students_family_id: fam.id } });
        customerId = c.id;
        db.update(families).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(families.id, fam.id)).run();
      }
      const si = await stripe.setupIntents.create({ customer: customerId, usage: 'off_session', metadata: { omos_app: 'students-portal', students_family_id: fam.id } });
      return { clientSecret: si.client_secret, publishableKey: publishableKey() };
    } catch (e) {
      payLog.error('createSetupIntent failed', { familyId: fam.id, error: (e as Error).message });
      throw new TRPCError({ code: 'BAD_GATEWAY', message: 'We couldn’t set up your card just now. Please try again in a moment.' });
    }
  }),

  /** After the browser confirms the SetupIntent, persist the card REFERENCE (brand/last4/exp — never a
   *  PAN) and attach it to the family's Stripe Customer. The first saved card becomes the default. */
  saveCard: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64), paymentMethodId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    const stripe = stripeClient();
    if (!stripe) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Card payments are temporarily unavailable.' });
    const fam = db.select({ stripeCustomerId: families.stripeCustomerId }).from(families).where(eq(families.id, input.familyId)).get();
    if (!fam?.stripeCustomerId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Family not found.' });
    try {
      const pm = await stripe.paymentMethods.retrieve(input.paymentMethodId);
      // Guard: the PM must belong to THIS family's customer (never attach someone else's card).
      if (pm.customer && pm.customer !== fam.stripeCustomerId) throw new Error('pm_customer_mismatch');
      if (!pm.customer) await stripe.paymentMethods.attach(input.paymentMethodId, { customer: fam.stripeCustomerId });
      const isFirst = !db.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.familyId, input.familyId)).get();
      const ts = new Date();
      db.insert(paymentMethods).values({ id: pm.id, familyId: input.familyId, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null, expMonth: pm.card?.exp_month ?? null, expYear: pm.card?.exp_year ?? null, isDefault: isFirst, createdAt: ts }).onConflictDoNothing().run();
      return { ok: true as const };
    } catch (e) {
      payLog.error('saveCard failed', { familyId: input.familyId, error: (e as Error).message });
      throw new TRPCError({ code: 'BAD_GATEWAY', message: 'We couldn’t save that card. Please try again.' });
    }
  }),

  /** Remove a saved card. If it was the autopay default, autopay is turned off (no card to charge). */
  removeCard: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64), paymentMethodId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    if (!db.select({ id: paymentMethods.id }).from(paymentMethods).where(and(eq(paymentMethods.id, input.paymentMethodId), eq(paymentMethods.familyId, input.familyId))).get()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found.' });
    }
    db.delete(paymentMethods).where(eq(paymentMethods.id, input.paymentMethodId)).run();
    const enr = db.select().from(autopayEnrollments).where(eq(autopayEnrollments.familyId, input.familyId)).get();
    if (enr?.defaultPmId === input.paymentMethodId) {
      db.update(autopayEnrollments).set({ enabled: false, defaultPmId: null, updatedAt: new Date() }).where(eq(autopayEnrollments.familyId, input.familyId)).run();
    }
    const stripe = stripeClient();
    if (stripe) { try { await stripe.paymentMethods.detach(input.paymentMethodId); } catch { /* best-effort */ } }
    return { ok: true as const };
  }),

  /** Turn autopay on/off for a family (§13.3). Enabling requires a saved card + records consent. */
  setAutopay: parentProcedure.input(z.object({ familyId: z.string().min(1).max(64), enabled: z.boolean() })).mutation(({ ctx, input }) => {
    assertFamilyAccess(ctx, input.familyId);
    const ts = new Date();
    const enr = db.select().from(autopayEnrollments).where(eq(autopayEnrollments.familyId, input.familyId)).get();
    if (input.enabled) {
      const def = db.select({ id: paymentMethods.id }).from(paymentMethods).where(and(eq(paymentMethods.familyId, input.familyId), eq(paymentMethods.isDefault, true))).get() ?? db.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.familyId, input.familyId)).get();
      if (!def) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add a card before turning on autopay.' });
      if (enr) db.update(autopayEnrollments).set({ enabled: true, defaultPmId: def.id, consentAt: ts, failureCount: 0, nextAttemptAt: null, updatedAt: ts }).where(eq(autopayEnrollments.familyId, input.familyId)).run();
      else db.insert(autopayEnrollments).values({ familyId: input.familyId, enabled: true, defaultPmId: def.id, consentAt: ts, failureCount: 0, nextAttemptAt: null, createdAt: ts, updatedAt: ts }).run();
    } else if (enr) {
      db.update(autopayEnrollments).set({ enabled: false, updatedAt: ts }).where(eq(autopayEnrollments.familyId, input.familyId)).run();
    }
    return { ok: true as const };
  }),

  /** One of the parent's kids: their weekly timetable (sessions across all enrolled classes). */
  childSchedule: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const classIds = db.select({ classId: enrollments.classId }).from(enrollments).where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active'))).all().map((r) => r.classId);
    if (!classIds.length) return { sessions: [] as ScheduleSession[] };
    const sessions = db
      .select({ id: classSessions.id, classId: classSessions.classId, className: classes.name, classType: classes.type, customLabel: classes.customLabel, dayOfWeek: classSessions.dayOfWeek, startMin: classSessions.startMin, endMin: classSessions.endMin, room: classSessions.room })
      .from(classSessions)
      .innerJoin(classes, eq(classes.id, classSessions.classId))
      .where(inArray(classSessions.classId, classIds))
      .orderBy(asc(classSessions.dayOfWeek), asc(classSessions.startMin))
      .all();
    return { sessions };
  }),
});

type ScheduleSession = {
  id: string;
  classId: string;
  className: string;
  classType: 'maktab' | 'hifz' | 'nazrah' | 'alim' | 'custom';
  customLabel: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  room: string | null;
};

type ReportChild = {
  studentId: string;
  name: string;
  reportCards: { id: string; className: string; version: number; generatedAt: Date }[];
  transcripts: { id: string; version: number; generatedAt: Date }[];
};

type FamilyView = {
  id: string;
  name: string;
  balance: ReturnType<typeof familyBalance>;
  students: { id: string; firstName: string; lastName: string; pin: string }[];
  invoices: { id: string; label: string; dueDate: string | null; balanceCents: number }[];
  payments: { id: string; amountCents: number; channel: string; occurredAt: Date; memo: string | null; reversalOf: string | null }[];
};
