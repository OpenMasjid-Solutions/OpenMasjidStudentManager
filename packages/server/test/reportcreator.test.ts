// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report Creator (CLAUDE.md §5, §14): dataset role-scoping (admin all; finance billing+directory
 * only; teacher/parent none), column projection / filter / sort over code-defined datasets, and the
 * no-injection guarantee — unknown column keys in picks are ignored, never a SQL surface.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { admissions, paymentAllocations, payments, invoiceItems, invoices, enrollmentFees, feePlans, enrollments, classes, terms, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel' } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: `usr_${role}` } }).ctx);

beforeAll(async () => { app = await freshApp(); });
beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [admissions, paymentAllocations, payments, invoiceItems, invoices, enrollmentFees, feePlans, enrollments, classes, terms, students, families, users, auditLog]) db.delete(t).run();
});

async function seed() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Maktab A', type: 'maktab' });
  const famA = await admin.people.familyCreate({ name: 'Ismail' });
  const famB = await admin.people.familyCreate({ name: 'Farooqi' });
  const s1 = await admin.people.studentCreate({ familyId: famA.id, firstName: 'Yusuf', lastName: 'Ismail' });
  await admin.people.studentCreate({ familyId: famB.id, firstName: 'Bilal', lastName: 'Farooqi' });
  await admin.classes.enroll({ classId: cls.id, studentId: s1.id });
  const plan = await admin.billing.feePlanCreate({ name: 'Tuition', amountCents: 5000, cadence: 'monthly' });
  for (const f of await admin.billing.familyFees({ familyId: famA.id })) await admin.billing.assignFee({ enrollmentId: f.enrollmentId, feePlanId: plan.id });
  await admin.admissions.create({ guardianName: 'Abu Zayd', childFirstName: 'Zayd', childLastName: 'Noor', programInterest: 'hifz' });
  return { admin };
}

describe('dataset role-scoping', () => {
  it('admin sees all datasets; finance sees billing+directory only; teacher/parent none', async () => {
    await seed();
    const adminSets = (await caller('admin').reportCreator.datasets()).map((d) => d.key).sort();
    expect(adminSets).toEqual(['admissions', 'directory', 'invoices', 'payments']);
    const finSets = (await caller('finance').reportCreator.datasets()).map((d) => d.key).sort();
    expect(finSets).toEqual(['directory', 'invoices', 'payments']); // NOT admissions (admin-only)
    for (const r of ['teacher', 'parent'] as const) {
      await expect(caller(r).reportCreator.datasets()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('finance cannot run an admin-only dataset', async () => {
    await seed();
    await expect(caller('finance').reportCreator.run({ datasetKey: 'admissions' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // admin can.
    expect((await caller('admin').reportCreator.run({ datasetKey: 'admissions' })).rows.length).toBe(1);
  });
});

describe('run: projection / filter / sort / no-injection', () => {
  it('projects only the picked (declared) columns and filters by text', async () => {
    await seed();
    const admin = caller('admin');
    const r = await admin.reportCreator.run({ datasetKey: 'directory', columns: ['firstName', 'family'], filters: [{ col: 'family', op: 'contains', value: 'ismail' }] });
    expect(r.columns.map((c) => c.key)).toEqual(['firstName', 'family']);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({ firstName: 'Yusuf', family: 'Ismail' });
  });

  it('sorts by a declared column', async () => {
    await seed();
    const r = await caller('admin').reportCreator.run({ datasetKey: 'directory', columns: ['lastName'], sort: { col: 'lastName', dir: 'desc' } });
    expect(r.rows.map((x) => x.lastName)).toEqual(['Ismail', 'Farooqi']); // desc
  });

  it('ignores unknown columns and unknown filter columns (never a SQL surface)', async () => {
    await seed();
    const r = await caller('admin').reportCreator.run({
      datasetKey: 'directory',
      columns: ['firstName', "'; DROP TABLE students; --", 'lastName'],
      filters: [{ col: 'bogus OR 1=1', op: 'equals', value: 'x' }],
    });
    // Only the two real columns survive; the injection-shaped keys are dropped; the bogus filter is a no-op.
    expect(r.columns.map((c) => c.key)).toEqual(['firstName', 'lastName']);
    expect(r.rows).toHaveLength(2); // filter ignored → both students returned
    // The students table is very much still there.
    expect(app.dbmod.db.select().from(students).all()).toHaveLength(2);
  });

  it('an unknown dataset is a NOT_FOUND', async () => {
    await seed();
    await expect(caller('admin').reportCreator.run({ datasetKey: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('money-column filters compare the DISPLAYED dollar value, not raw cents', async () => {
    const { admin } = await seed();
    // Family A has a $50 fee assigned; generate its invoice ($50.00 = 5000 cents).
    const dir = await admin.people.directory();
    const famA = dir.find((f) => f.name === 'Ismail')!;
    await admin.billing.generateFamily({ familyId: famA.id, periodKey: '2026-07', label: 'Tuition — Jul 2026', dueDate: '2026-07-01' });
    // equals "50" (dollars) matches the $50.00 invoice; equals against raw cents "5000" must NOT.
    const eq50 = await admin.reportCreator.run({ datasetKey: 'invoices', columns: ['label', 'total'], filters: [{ col: 'total', op: 'equals', value: '50' }] });
    expect(eq50.rows).toHaveLength(1);
    const eq50dot = await admin.reportCreator.run({ datasetKey: 'invoices', columns: ['total'], filters: [{ col: 'total', op: 'equals', value: '50.00' }] });
    expect(eq50dot.rows).toHaveLength(1);
    const eqCents = await admin.reportCreator.run({ datasetKey: 'invoices', columns: ['total'], filters: [{ col: 'total', op: 'equals', value: '5000' }] });
    expect(eqCents.rows).toHaveLength(0); // raw cents no longer matches
    // contains matches the formatted "$50.00".
    const cont = await admin.reportCreator.run({ datasetKey: 'invoices', columns: ['total'], filters: [{ col: 'total', op: 'contains', value: '50.00' }] });
    expect(cont.rows).toHaveLength(1);
  });
});
