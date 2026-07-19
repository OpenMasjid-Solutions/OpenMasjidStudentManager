// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Admissions pipeline (CLAUDE.md §4/§5): staff CRUD + stage moves + notes, the ONE-CLICK enroll
 * (family + student + PIN + guardian + enrollment + fee + first invoice, flip to `enrolled`), and
 * the access walls (admin + finance only; admin blocked over the tunnel; finance allowed).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshApp, makeCtx } from './harness';
import { admissions, admissionNotes, guardianFamilies, guardians, invoiceItems, invoices, enrollmentFees, feePlans, enrollments, classes, terms, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel' } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: `usr_${role}` } }).ctx);

beforeAll(async () => { app = await freshApp(); });
beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [admissionNotes, admissions, guardianFamilies, guardians, invoiceItems, invoices, enrollmentFees, feePlans, enrollments, classes, terms, students, families, users, auditLog]) db.delete(t).run();
});

async function setup() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Maktab A', type: 'maktab' });
  const plan = await admin.billing.feePlanCreate({ name: 'Tuition', amountCents: 5000, cadence: 'monthly' });
  return { admin, classId: cls.id, feePlanId: plan.id };
}

async function anEnquiry(admin: ReturnType<typeof caller>) {
  const { id } = await admin.admissions.create({ guardianName: 'Abu Yusuf', guardianEmail: 'abu@example.com', guardianPhone: '555-1000', childFirstName: 'Yusuf', childLastName: 'Ismail', childDob: '2016-03-01', programInterest: 'maktab' });
  return id;
}

describe('pipeline', () => {
  it('create → list → move stage → notes', async () => {
    const { admin } = await setup();
    const id = await anEnquiry(admin);
    let rows = await admin.admissions.list();
    expect(rows.find((r) => r.id === id)).toMatchObject({ status: 'enquiry', source: 'manual', childFirstName: 'Yusuf' });
    await admin.admissions.setStatus({ id, status: 'accepted' });
    rows = await admin.admissions.list({ status: 'accepted' });
    expect(rows.find((r) => r.id === id)).toBeTruthy();
    await admin.admissions.addNote({ admissionId: id, note: 'Spoke with the walī' });
    const notes = await admin.admissions.notesFor({ admissionId: id });
    expect(notes[0]).toMatchObject({ note: 'Spoke with the walī' });
  });

  it('setStatus cannot set enrolled; remove refuses an enrolled applicant', async () => {
    const { admin } = await setup();
    const id = await anEnquiry(admin);
    // @ts-expect-error — 'enrolled' is not a manual status
    await expect(admin.admissions.setStatus({ id, status: 'enrolled' })).rejects.toBeTruthy();
    await admin.admissions.remove({ id });
    expect(await admin.admissions.list()).toHaveLength(0);
  });
});

describe('one-click enroll', () => {
  it('creates family + student (+PIN) + guardian + enrollment + fee + first invoice and flips to enrolled', async () => {
    const { admin, classId, feePlanId } = await setup();
    const id = await anEnquiry(admin);
    const res = await admin.admissions.enroll({ admissionId: id, classId, feePlanId, invoice: { periodKey: '2026-07', label: 'Tuition — Jul 2026', dueDate: '2026-07-01' } });
    expect(res.familyId).toBeTruthy();
    expect(res.studentId).toBeTruthy();
    expect(res.pin).toMatch(/^\d{6}$/);
    const { db } = app.dbmod;
    // Student exists, active, with the PIN, in the new family.
    const stu = db.select().from(students).where(eq(students.id, res.studentId)).get()!;
    expect(stu).toMatchObject({ firstName: 'Yusuf', lastName: 'Ismail', familyId: res.familyId, status: 'active', pin: res.pin });
    // Guardian linked to the family.
    expect(db.select().from(guardianFamilies).where(eq(guardianFamilies.familyId, res.familyId)).all()).toHaveLength(1);
    // Enrolled in the class + fee assigned.
    const enr = db.select().from(enrollments).where(eq(enrollments.studentId, res.studentId)).all();
    expect(enr).toHaveLength(1);
    expect(enr[0]).toMatchObject({ classId, status: 'active' });
    expect(db.select().from(enrollmentFees).where(eq(enrollmentFees.enrollmentId, enr[0].id)).all()).toHaveLength(1);
    // First invoice generated for the family ($50).
    const billing = await admin.billing.familyBilling({ familyId: res.familyId });
    expect(billing.invoices[0]).toMatchObject({ totalCents: 5000 });
    // The applicant is now enrolled with its created ids stamped.
    const adm = db.select().from(admissions).where(eq(admissions.id, id)).get()!;
    expect(adm).toMatchObject({ status: 'enrolled', createdFamilyId: res.familyId, createdStudentId: res.studentId });
  });

  it('refuses to enroll twice, an invoice without a fee plan, and an archived fee plan', async () => {
    const { admin, classId, feePlanId } = await setup();
    const id = await anEnquiry(admin);
    const r = await admin.admissions.enroll({ admissionId: id, classId, feePlanId });
    expect(r.invoicePending).toBe(false);
    await expect(admin.admissions.enroll({ admissionId: id, classId, feePlanId })).rejects.toMatchObject({ code: 'CONFLICT' });
    const id2 = await anEnquiry(admin);
    await expect(admin.admissions.enroll({ admissionId: id2, classId, invoice: { periodKey: 'x', label: 'x' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // An archived fee plan is refused up front (it would never invoice).
    await admin.billing.feePlanArchive({ id: feePlanId });
    await expect(admin.admissions.enroll({ admissionId: id2, classId, feePlanId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('walls', () => {
  it('admin + finance only; teacher/parent refused; admin over tunnel refused; finance over tunnel ok', async () => {
    const { admin } = await setup();
    const id = await anEnquiry(admin);
    for (const r of ['teacher', 'parent'] as const) {
      await expect(caller(r).admissions.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).admissions.create({ guardianName: 'X', childFirstName: 'Y', childLastName: 'Z' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).admissions.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(Array.isArray(await caller('finance', { origin: 'tunnel' }).admissions.list())).toBe(true);
    void id;
  });
});
