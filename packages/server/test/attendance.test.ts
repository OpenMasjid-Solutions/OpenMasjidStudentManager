// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Attendance (CLAUDE.md §4/§5/§9): marking + reading a class day, the UNIQUE upsert, the
 * teacher wall (own classes only; finance/parent refused; admin over tunnel refused), and
 * the audit rules — a fresh same-day mark is routine; edits and past-date (late) marks are
 * audited.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { attendance, enrollments, classTeachers, classSubjects, classSessions, classes, terms, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(() => {
  const { db } = app.dbmod;
  db.delete(attendance).run();
  db.delete(enrollments).run();
  db.delete(classTeachers).run();
  db.delete(classSubjects).run();
  db.delete(classSessions).run();
  db.delete(classes).run();
  db.delete(terms).run();
  db.delete(students).run();
  db.delete(families).run();
  db.delete(users).run();
  db.delete(auditLog).run();
});

async function scenario() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Maktab A', type: 'maktab' });
  const { id: teacherId } = await admin.staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
  await admin.classes.assignTeacher({ classId: cls.id, userId: teacherId });
  const fam = await admin.people.familyCreate({ name: 'Fam' });
  const s1 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Ayah', lastName: 'K' });
  const s2 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Bilal', lastName: 'K' });
  await admin.classes.enroll({ classId: cls.id, studentId: s1.id });
  await admin.classes.enroll({ classId: cls.id, studentId: s2.id });
  return { admin, classId: cls.id, teacherId, s1: s1.id, s2: s2.id };
}

const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

describe('mark + read', () => {
  it('teacher marks their class; read returns statuses; upsert keeps one row per student/date', async () => {
    const { classId, teacherId, s1, s2 } = await scenario();
    const teacher = caller('teacher', { userId: teacherId });
    await teacher.attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }, { studentId: s2, status: 'absent' }] });
    let read = await teacher.attendance.forClassDate({ classId, date: today() });
    expect(read.roster.find((r) => r.studentId === s1)?.status).toBe('present');
    expect(read.roster.find((r) => r.studentId === s2)?.status).toBe('absent');
    // Re-mark s2 → still a single row (unique upsert), status updated.
    await teacher.attendance.mark({ classId, date: today(), entries: [{ studentId: s2, status: 'late' }] });
    read = await teacher.attendance.forClassDate({ classId, date: today() });
    expect(read.roster.find((r) => r.studentId === s2)?.status).toBe('late');
    expect(app.dbmod.db.select().from(attendance).all()).toHaveLength(2);
  });

  it('rejects marking a student not enrolled in the class', async () => {
    const { admin, classId } = await scenario();
    const fam = await admin.people.familyCreate({ name: 'Other' });
    const outsider = await admin.people.studentCreate({ familyId: fam.id, firstName: 'X', lastName: 'Y' });
    await expect(admin.attendance.mark({ classId, date: today(), entries: [{ studentId: outsider.id, status: 'present' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects a duplicate student in one submission with a friendly error (no raw UNIQUE crash)', async () => {
    const { admin, classId, s1 } = await scenario();
    await expect(admin.attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }, { studentId: s1, status: 'absent' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(app.dbmod.db.select().from(attendance).all()).toHaveLength(0); // nothing partially written
  });
});

describe('audit rules', () => {
  it('a fresh same-day mark is not audited; an edit is', async () => {
    const { admin, classId, s1 } = await scenario();
    await admin.attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }] });
    expect(app.dbmod.db.select().from(auditLog).all().filter((a) => a.action.startsWith('attendance'))).toHaveLength(0);
    await admin.attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'absent' }] }); // edit
    const edits = app.dbmod.db.select().from(auditLog).all().filter((a) => a.action === 'attendance.edit');
    expect(edits).toHaveLength(1);
    // No student-level PII in the audit detail (counts + date only).
    expect(JSON.stringify(edits[0].detail)).not.toContain(s1);
  });

  it('marking a past date is audited as a late mark', async () => {
    const { admin, classId, s1 } = await scenario();
    const r = await admin.attendance.mark({ classId, date: '2020-01-06', entries: [{ studentId: s1, status: 'present' }] });
    expect(r.late).toBe(true);
    expect(app.dbmod.db.select().from(auditLog).all().filter((a) => a.action === 'attendance.lateMark')).toHaveLength(1);
  });

  it('classifies backfill by the client-provided day, not the server clock (timezone-safe)', async () => {
    const { admin, classId, s1 } = await scenario();
    const lateLogs = () => app.dbmod.db.select().from(auditLog).all().filter((a) => a.action === 'attendance.lateMark');
    // A mark whose date == the client's "today" is NOT a backfill, even if it differs from the server's UTC day.
    const same = await admin.attendance.mark({ classId, date: '2030-06-15', clientToday: '2030-06-15', entries: [{ studentId: s1, status: 'present' }] });
    expect(same.late).toBe(false);
    expect(lateLogs()).toHaveLength(0);
    // A date before the client's today IS a backfill → audited.
    const back = await admin.attendance.mark({ classId, date: '2030-06-14', clientToday: '2030-06-15', entries: [{ studentId: s1, status: 'present' }] });
    expect(back.late).toBe(true);
    expect(lateLogs()).toHaveLength(1);
  });
});

describe('role + origin walls', () => {
  it('teacher cannot mark/read an unassigned class; finance + parent are refused entirely', async () => {
    const { admin, classId, s1 } = await scenario();
    const term = (await admin.classes.termList())[0];
    const foreign = await admin.classes.classCreate({ termId: term.id, name: 'Not mine', type: 'maktab' });
    const otherTeacher = caller('teacher', { userId: 'usr_stranger' });
    await expect(otherTeacher.attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(otherTeacher.attendance.forClassDate({ classId, date: today() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    void foreign;
    for (const r of ['finance', 'parent'] as const) {
      await expect(caller(r).attendance.forClassDate({ classId, date: today() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('admin over the tunnel is blocked', async () => {
    const { classId, s1 } = await scenario();
    await expect(caller('admin', { origin: 'tunnel' }).attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a teacher may mark from the tunnel (allowed origin)', async () => {
    const { classId, teacherId, s1 } = await scenario();
    const teacher = caller('teacher', { userId: teacherId, origin: 'tunnel' });
    const r = await teacher.attendance.mark({ classId, date: today(), entries: [{ studentId: s1, status: 'present' }] });
    expect(r.ok).toBe(true);
  });
});
