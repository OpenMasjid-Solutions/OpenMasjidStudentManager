// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Admissions pipeline (CLAUDE.md §4/§5): enquiry → application → accepted | waitlisted | declined
 * → enrolled, with per-applicant staff notes and a ONE-CLICK enroll that creates the family +
 * student (+ guardian, PIN) + enrollment (+ optional fee + first invoice) in one transaction and
 * flips the row to `enrolled`. Admin + finance only (finance LAN + tunnel, admin LAN-only). The
 * anonymous public /apply form (a later slice) writes here too, so every stored field is inert text.
 * Applicant data is hostile input — never rendered as HTML on the client.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, desc } from 'drizzle-orm';
import { router, adminOrFinanceProcedure, auditActor } from './trpc';
import { db } from '../db';
import { admissions, admissionNotes, families, students, guardians, guardianFamilies, enrollments, enrollmentFees, classes, feePlans } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { makeLog } from '../logger';
import { generateUniquePin } from '../billing/pins';
import { generateForFamily } from '../billing/invoices';

const log = makeLog('admissions');

const ID = z.string().min(1).max(64);
const TEXT = z.string().trim().max(200);
const now = () => new Date();
/** Pipeline stages a human may set by hand; `enrolled` is reachable ONLY via one-click enroll. */
const MANUAL_STATUS = z.enum(['enquiry', 'application', 'accepted', 'waitlisted', 'declined']);

export const admissionsRouter = router({
  /** The pipeline. Optional status filter; newest first. */
  list: adminOrFinanceProcedure.input(z.object({ status: z.enum(['enquiry', 'application', 'accepted', 'waitlisted', 'declined', 'enrolled']).optional() }).optional()).query(({ input }) => {
    const rows = input?.status
      ? db.select().from(admissions).where(eq(admissions.status, input.status)).orderBy(desc(admissions.createdAt)).all()
      : db.select().from(admissions).orderBy(desc(admissions.createdAt)).all();
    return rows.map((r) => ({
      id: r.id, status: r.status, source: r.source, guardianName: r.guardianName, guardianPhone: r.guardianPhone, guardianEmail: r.guardianEmail,
      childFirstName: r.childFirstName, childLastName: r.childLastName, childDob: r.childDob, programInterest: r.programInterest,
      createdStudentId: r.createdStudentId, createdAt: r.createdAt,
    }));
  }),

  /** Active classes for the one-click-enroll picker (admin + finance; classList itself is admin-only). */
  classesForEnroll: adminOrFinanceProcedure.query(() =>
    db.select({ id: classes.id, name: classes.name, type: classes.type, customLabel: classes.customLabel }).from(classes).where(eq(classes.status, 'active')).orderBy(asc(classes.name)).all(),
  ),

  /** Staff manually add an applicant (the public form path lands in a later slice). */
  create: adminOrFinanceProcedure
    .input(z.object({ guardianName: z.string().trim().min(1).max(120), guardianPhone: TEXT.optional(), guardianEmail: TEXT.optional(), childFirstName: z.string().trim().min(1).max(120), childLastName: z.string().trim().min(1).max(120), childDob: z.string().max(20).optional(), programInterest: TEXT.optional() }))
    .mutation(({ ctx, input }) => {
      const id = rid('adm');
      const ts = now();
      db.insert(admissions).values({
        id, status: 'enquiry', source: 'manual',
        guardianName: input.guardianName, guardianPhone: input.guardianPhone || null, guardianEmail: input.guardianEmail || null,
        childFirstName: input.childFirstName, childLastName: input.childLastName, childDob: input.childDob || null, programInterest: input.programInterest || null,
        fieldsJson: null, createdFamilyId: null, createdStudentId: null, createdAt: ts, updatedAt: ts,
      }).run();
      audit(auditActor(ctx), 'admission.create', { entity: 'admission', entityId: id, detail: { source: 'manual' } });
      return { id };
    }),

  /** Move an applicant along the pipeline (never to `enrolled` — that's one-click enroll only). */
  setStatus: adminOrFinanceProcedure.input(z.object({ id: ID, status: MANUAL_STATUS })).mutation(({ ctx, input }) => {
    const adm = db.select({ id: admissions.id, status: admissions.status }).from(admissions).where(eq(admissions.id, input.id)).get();
    if (!adm) throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
    if (adm.status === 'enrolled') throw new TRPCError({ code: 'CONFLICT', message: 'This applicant is already enrolled.' });
    db.update(admissions).set({ status: input.status, updatedAt: now() }).where(eq(admissions.id, input.id)).run();
    audit(auditActor(ctx), 'admission.setStatus', { entity: 'admission', entityId: input.id, detail: { status: input.status } });
    return { ok: true as const };
  }),

  remove: adminOrFinanceProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const adm = db.select({ status: admissions.status }).from(admissions).where(eq(admissions.id, input.id)).get();
    if (!adm) throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
    if (adm.status === 'enrolled') throw new TRPCError({ code: 'CONFLICT', message: 'An enrolled applicant can’t be removed.' });
    db.delete(admissions).where(eq(admissions.id, input.id)).run(); // notes cascade
    audit(auditActor(ctx), 'admission.remove', { entity: 'admission', entityId: input.id });
    return { ok: true as const };
  }),

  notesFor: adminOrFinanceProcedure.input(z.object({ admissionId: ID })).query(({ input }) =>
    db.select({ id: admissionNotes.id, note: admissionNotes.note, by: admissionNotes.byName, at: admissionNotes.createdAt }).from(admissionNotes).where(eq(admissionNotes.admissionId, input.admissionId)).orderBy(desc(admissionNotes.createdAt)).all(),
  ),

  addNote: adminOrFinanceProcedure.input(z.object({ admissionId: ID, note: z.string().trim().min(1).max(2000) })).mutation(({ ctx, input }) => {
    if (!db.select({ id: admissions.id }).from(admissions).where(eq(admissions.id, input.admissionId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
    const actor = auditActor(ctx);
    db.insert(admissionNotes).values({ id: rid('adn'), admissionId: input.admissionId, note: input.note, byUserId: actor.userId, byName: actor.name, createdAt: now() }).run();
    return { ok: true as const };
  }),

  /** ONE-CLICK ENROLL (§4): family + student (+ PIN) + guardian + enrollment (+ optional fee +
   *  first invoice), all in one transaction; the applicant flips to `enrolled`. Idempotent-ish:
   *  refuses a row that's already enrolled. Portal invite is sent separately from the family record. */
  enroll: adminOrFinanceProcedure
    .input(z.object({ admissionId: ID, classId: ID, feePlanId: ID.optional(), invoice: z.object({ periodKey: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(120), dueDate: z.string().max(20).optional() }).optional() }))
    .mutation(({ ctx, input }) => {
      const adm = db.select().from(admissions).where(eq(admissions.id, input.admissionId)).get();
      if (!adm) throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found.' });
      if (adm.status === 'enrolled') throw new TRPCError({ code: 'CONFLICT', message: 'This applicant is already enrolled.' });
      if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
      // Require an ACTIVE fee plan (the invoice engine only bills active plans, so an archived one
      // would create an enrollment fee that silently never invoices).
      if (input.feePlanId && !db.select({ id: feePlans.id }).from(feePlans).where(and(eq(feePlans.id, input.feePlanId), eq(feePlans.status, 'active'))).get()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That fee plan isn’t available — pick an active plan.' });
      if (input.invoice && !input.feePlanId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Assign a fee plan to generate an invoice.' });

      const pin = generateUniquePin(); // outside the txn (does its own reads); UNIQUE catches any race
      const ts = now();
      const familyId = rid('fam');
      const studentId = rid('stu');
      db.transaction((tx) => {
        tx.insert(families).values({ id: familyId, name: adm.childLastName || adm.guardianName || 'Family', notes: null, status: 'active', discountKind: 'none', discountValue: 0, createdAt: ts, updatedAt: ts }).run();
        tx.insert(students).values({ id: studentId, familyId, firstName: adm.childFirstName, lastName: adm.childLastName, dob: adm.childDob, status: 'active', notes: null, pin, pinUpdatedAt: ts, createdAt: ts, updatedAt: ts }).run();
        const guardianId = rid('grd');
        tx.insert(guardians).values({ id: guardianId, name: adm.guardianName, phone: adm.guardianPhone, email: adm.guardianEmail, createdAt: ts, updatedAt: ts }).run();
        tx.insert(guardianFamilies).values({ guardianId, familyId, relation: null, isEmergencyContact: false, createdAt: ts }).run();
        const enrId = rid('enr');
        tx.insert(enrollments).values({ id: enrId, classId: input.classId, studentId, status: 'active', createdAt: ts, updatedAt: ts }).run();
        if (input.feePlanId) tx.insert(enrollmentFees).values({ id: rid('enf'), enrollmentId: enrId, feePlanId: input.feePlanId, createdAt: ts }).run();
        tx.update(admissions).set({ status: 'enrolled', createdFamilyId: familyId, createdStudentId: studentId, updatedAt: ts }).where(eq(admissions.id, adm.id)).run();
      });
      // The enroll is committed — audit it now, BEFORE the fallible invoice step, so the sensitive
      // write is always recorded even if invoice generation later fails (§14).
      audit(auditActor(ctx), 'admission.enroll', { entity: 'admission', entityId: adm.id, detail: { familyId, studentId, classId: input.classId } });
      // First invoice after the fee is committed (generateForFamily reads the enrollment's fee). It
      // runs outside the txn (better-sqlite3 has no nested txns), so a failure here must NOT undo the
      // enroll or wedge a retry — the enroll succeeded; the invoice is best-effort + regenerable from Billing.
      let invoicePending = false;
      if (input.invoice && input.feePlanId) {
        try {
          generateForFamily(familyId, { periodKey: input.invoice.periodKey, label: input.invoice.label, dueDate: input.invoice.dueDate || null });
        } catch (e) {
          invoicePending = true;
          log.warn('enroll: first-invoice generation deferred', { admissionId: adm.id, error: (e as Error).message });
        }
      }
      return { familyId, studentId, pin, invoicePending };
    }),
});
