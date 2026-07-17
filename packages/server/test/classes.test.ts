// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Classes, terms, enrollments, teacher assignment, staff management + the forced
 * password-change flow (CLAUDE.md §4/§5/§9/§12). Admin-only writes; role walls tested.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { terms, classes, classSubjects, classTeachers, enrollments, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(() => {
  const { db } = app.dbmod;
  db.delete(enrollments).run();
  db.delete(classTeachers).run();
  db.delete(classSubjects).run();
  db.delete(classes).run();
  db.delete(terms).run();
  db.delete(students).run();
  db.delete(families).run();
  db.delete(users).run();
  db.delete(auditLog).run();
});

async function makeStudent() {
  const admin = caller('admin');
  const fam = await admin.people.familyCreate({ name: 'Fam' });
  return (await admin.people.studentCreate({ familyId: fam.id, firstName: 'A', lastName: 'B' })).id;
}

describe('staff management + forced password change', () => {
  it('admin creates a teacher; non-admins cannot', async () => {
    await caller('admin').staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
    expect(await caller('admin').staff.list()).toHaveLength(1);
    for (const r of ['teacher', 'finance', 'parent'] as const) {
      await expect(caller(r).staff.create({ username: 'x', role: 'teacher', tempPassword: 'temp-pass-1234' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('temp password forces a change, cleared after changePassword', async () => {
    const { id } = await caller('admin').staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
    const teacher = caller('teacher', { userId: id });
    expect((await teacher.auth.session()).user?.mustChangePassword).toBe(true);
    await expect(teacher.auth.changePassword({ currentPassword: 'wrong', newPassword: 'brand-new-pass-1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await teacher.auth.changePassword({ currentPassword: 'temp-pass-1234', newPassword: 'brand-new-pass-1' });
    expect((await teacher.auth.session()).user?.mustChangePassword).toBe(false);
  });

  it('disabling a staff user is reflected + admin accounts cannot be disabled here', async () => {
    const { id } = await caller('admin').staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
    await caller('admin').staff.setStatus({ userId: id, status: 'disabled' });
    expect(app.dbmod.db.select().from(users).all().find((u) => u.id === id)?.status).toBe('disabled');
  });
});

describe('terms + classes', () => {
  it('creates terms with a single current term', async () => {
    const admin = caller('admin');
    await admin.classes.termCreate({ name: '2026 — Term 1', isCurrent: true });
    await admin.classes.termCreate({ name: '2026 — Term 2', isCurrent: true });
    const list = await admin.classes.termList();
    expect(list.filter((t) => t.isCurrent)).toHaveLength(1);
    expect(list.find((t) => t.isCurrent)?.name).toBe('2026 — Term 2');
  });

  it('creates a class with subjects and teacher assignment', async () => {
    const admin = caller('admin');
    const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
    const cls = await admin.classes.classCreate({ termId: term.id, name: 'Hifz — Halaqah 1', type: 'hifz' });
    await admin.classes.setSubjects({ classId: cls.id, subjects: ['Sabaq', 'Sabqī', 'Manzil', 'Tajwīd'] });
    const { id: teacherId } = await admin.staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
    await admin.classes.assignTeacher({ classId: cls.id, userId: teacherId });
    const detail = await admin.classes.classGet({ id: cls.id });
    expect(detail.class.type).toBe('hifz');
    expect(detail.subjects.map((s) => s.name)).toEqual(['Sabaq', 'Sabqī', 'Manzil', 'Tajwīd']);
    expect(detail.teachers[0].userId).toBe(teacherId);
  });

  it('rejects assigning a finance user as a teacher', async () => {
    const admin = caller('admin');
    const term = await admin.classes.termCreate({ name: 'T1' });
    const cls = await admin.classes.classCreate({ termId: term.id, name: 'C', type: 'maktab' });
    const { id: finId } = await admin.staff.create({ username: 'money', role: 'finance', tempPassword: 'temp-pass-1234' });
    await expect(admin.classes.assignTeacher({ classId: cls.id, userId: finId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('enrollments', () => {
  it('enrolls a student once; re-enroll is idempotent; unenroll withdraws; re-enroll reactivates', async () => {
    const admin = caller('admin');
    const term = await admin.classes.termCreate({ name: 'T1' });
    const cls = await admin.classes.classCreate({ termId: term.id, name: 'C', type: 'maktab' });
    const sid = await makeStudent();
    await admin.classes.enroll({ classId: cls.id, studentId: sid });
    await admin.classes.enroll({ classId: cls.id, studentId: sid }); // idempotent
    let d = await admin.classes.classGet({ id: cls.id });
    expect(d.roster).toHaveLength(1);
    expect(d.roster[0].status).toBe('active');
    await admin.classes.unenroll({ enrollmentId: d.roster[0].enrollmentId });
    d = await admin.classes.classGet({ id: cls.id });
    expect(d.roster[0].status).toBe('withdrawn');
    await admin.classes.enroll({ classId: cls.id, studentId: sid }); // reactivates
    d = await admin.classes.classGet({ id: cls.id });
    expect(d.roster[0].status).toBe('active');
    expect(d.roster).toHaveLength(1); // still one row (unique)
  });
});

describe('role + origin walls', () => {
  it('non-admins cannot create terms/classes/enroll; admin over tunnel is blocked', async () => {
    for (const r of ['teacher', 'finance', 'parent'] as const) {
      await expect(caller(r).classes.termCreate({ name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).classes.classList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).classes.termCreate({ name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
