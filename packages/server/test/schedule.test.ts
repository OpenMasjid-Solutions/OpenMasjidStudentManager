// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Weekly timetable + teacher scoping (CLAUDE.md §4/§5). Covers session CRUD, the soft
 * double-booking warnings (shared teacher / shared room), the by-class/by-teacher/by-student
 * views, `mySchedule`, and the teacher wall: a teacher sees ONLY their own classes/week,
 * and reading another teacher's class is refused.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { terms, classes, classSubjects, classTeachers, classSessions, enrollments, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(() => {
  const { db } = app.dbmod;
  db.delete(classSessions).run();
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

/** Build a term, a class, an assigned teacher user, and an enrolled student. */
async function scenario() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Hifz A', type: 'hifz' });
  const { id: teacherId } = await admin.staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
  await admin.classes.assignTeacher({ classId: cls.id, userId: teacherId });
  const fam = await admin.people.familyCreate({ name: 'Ismail' });
  const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Yusuf', lastName: 'Ismail' });
  await admin.classes.enroll({ classId: cls.id, studentId: stu.id });
  return { admin, termId: term.id, classId: cls.id, teacherId, studentId: stu.id };
}

describe('session CRUD', () => {
  it('creates, lists, updates and deletes a session; rejects end<=start', async () => {
    const { admin, classId } = await scenario();
    const { id, warnings } = await admin.schedule.createSession({ classId, dayOfWeek: 1, startMin: 600, endMin: 660, room: 'Room 1' });
    expect(warnings).toHaveLength(0);
    let { sessions } = await admin.schedule.byClass({ classId });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ dayOfWeek: 1, startMin: 600, endMin: 660, room: 'Room 1' });
    await admin.schedule.updateSession({ id, dayOfWeek: 2, startMin: 900, endMin: 960, room: 'Room 2' });
    ({ sessions } = await admin.schedule.byClass({ classId }));
    expect(sessions[0]).toMatchObject({ dayOfWeek: 2, startMin: 900 });
    await expect(admin.schedule.createSession({ classId, dayOfWeek: 1, startMin: 660, endMin: 600 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await admin.schedule.deleteSession({ id });
    ({ sessions } = await admin.schedule.byClass({ classId }));
    expect(sessions).toHaveLength(0);
  });
});

describe('soft conflict warnings', () => {
  it('warns when the same teacher is double-booked at an overlapping time (same term)', async () => {
    const { admin, termId, classId, teacherId } = await scenario();
    const other = await admin.classes.classCreate({ termId, name: 'Nazrah B', type: 'nazrah' });
    await admin.classes.assignTeacher({ classId: other.id, userId: teacherId });
    await admin.schedule.createSession({ classId, dayOfWeek: 1, startMin: 600, endMin: 700 });
    const { warnings } = await admin.schedule.createSession({ classId: other.id, dayOfWeek: 1, startMin: 650, endMin: 750 });
    expect(warnings.some((w) => w.kind === 'teacher')).toBe(true);
  });

  it('warns on a shared room; no warning when times do not overlap or rooms differ', async () => {
    const { admin, termId, classId } = await scenario();
    const other = await admin.classes.classCreate({ termId, name: 'Maktab C', type: 'maktab' }); // different teacher (none)
    await admin.schedule.createSession({ classId, dayOfWeek: 3, startMin: 600, endMin: 700, room: 'Main Hall' });
    const clash = await admin.schedule.createSession({ classId: other.id, dayOfWeek: 3, startMin: 650, endMin: 750, room: 'main hall' });
    expect(clash.warnings.some((w) => w.kind === 'room')).toBe(true);
    const noOverlap = await admin.schedule.createSession({ classId: other.id, dayOfWeek: 3, startMin: 800, endMin: 900, room: 'Main Hall' });
    expect(noOverlap.warnings).toHaveLength(0);
    const diffRoom = await admin.schedule.createSession({ classId: other.id, dayOfWeek: 3, startMin: 650, endMin: 750, room: 'Room 9' });
    expect(diffRoom.warnings).toHaveLength(0);
  });

  it('does not warn across different terms', async () => {
    const { admin, classId, teacherId } = await scenario();
    const t2 = await admin.classes.termCreate({ name: 'T2' });
    const other = await admin.classes.classCreate({ termId: t2.id, name: 'Other-term class', type: 'hifz' });
    await admin.classes.assignTeacher({ classId: other.id, userId: teacherId });
    await admin.schedule.createSession({ classId, dayOfWeek: 1, startMin: 600, endMin: 700, room: 'X' });
    const { warnings } = await admin.schedule.createSession({ classId: other.id, dayOfWeek: 1, startMin: 600, endMin: 700, room: 'X' });
    expect(warnings).toHaveLength(0);
  });
});

describe('timetable views', () => {
  it('by-teacher and by-student return the class sessions', async () => {
    const { admin, classId, teacherId, studentId } = await scenario();
    await admin.schedule.createSession({ classId, dayOfWeek: 4, startMin: 600, endMin: 660 });
    expect(await admin.schedule.byTeacher({ userId: teacherId })).toHaveLength(1);
    expect(await admin.schedule.byStudent({ studentId })).toHaveLength(1);
  });

  it('by-student excludes withdrawn enrollments', async () => {
    const { admin, classId, studentId } = await scenario();
    await admin.schedule.createSession({ classId, dayOfWeek: 4, startMin: 600, endMin: 660 });
    const d = await admin.classes.classGet({ id: classId });
    await admin.classes.unenroll({ enrollmentId: d.roster[0].enrollmentId });
    expect(await admin.schedule.byStudent({ studentId })).toHaveLength(0);
  });
});

describe('teacher scoping (the §5 wall)', () => {
  it('classes.mine returns only assigned classes; mineGet is refused for others', async () => {
    const { admin, termId, classId, teacherId } = await scenario();
    const foreign = await admin.classes.classCreate({ termId, name: 'Not mine', type: 'maktab' });
    const teacher = caller('teacher', { userId: teacherId });
    const mine = await teacher.classes.mine();
    expect(mine.map((c) => c.id)).toEqual([classId]);
    const detail = await teacher.classes.mineGet({ id: classId });
    expect(detail.class.id).toBe(classId);
    expect(detail.roster.map((r) => r.firstName)).toContain('Yusuf');
    expect('pin' in (detail.roster[0] as object)).toBe(false); // teachers never see PINs
    await expect(teacher.classes.mineGet({ id: foreign.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('mySchedule returns only the caller’s sessions and works over the tunnel', async () => {
    const { admin, termId, classId, teacherId } = await scenario();
    await admin.schedule.createSession({ classId, dayOfWeek: 2, startMin: 600, endMin: 660 });
    // A second teacher with their own class + session must not leak into the first teacher's week.
    const { id: t2 } = await admin.staff.create({ username: 'ustadh2', role: 'teacher', tempPassword: 'temp-pass-1234' });
    const c2 = await admin.classes.classCreate({ termId, name: 'Other', type: 'maktab' });
    await admin.classes.assignTeacher({ classId: c2.id, userId: t2 });
    await admin.schedule.createSession({ classId: c2.id, dayOfWeek: 5, startMin: 700, endMin: 760 });
    const teacher = caller('teacher', { userId: teacherId, origin: 'tunnel' });
    const week = await teacher.schedule.mySchedule();
    expect(week).toHaveLength(1);
    expect(week[0].classId).toBe(classId);
  });
});

describe('role + origin walls', () => {
  it('non-admins cannot edit sessions or use admin views; admin over tunnel is blocked', async () => {
    const { admin, classId, teacherId } = await scenario();
    for (const r of ['teacher', 'finance', 'parent'] as const) {
      await expect(caller(r).schedule.createSession({ classId, dayOfWeek: 1, startMin: 600, endMin: 660 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).schedule.byClass({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('finance').schedule.byTeacher({ userId: teacherId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('admin', { origin: 'tunnel' }).schedule.createSession({ classId, dayOfWeek: 1, startMin: 600, endMin: 660 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
