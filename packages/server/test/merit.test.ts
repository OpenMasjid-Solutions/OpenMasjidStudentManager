// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Merit points (CLAUDE.md §4/§5): shipped default categories, admin category management,
 * awarding/deducting within a class, the per-class totals + leaderboard, the teacher wall
 * (own classes only; finance/parent refused; admin over tunnel refused), and audit (no PII).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { meritAwards, meritCategories, enrollments, classTeachers, classSubjects, classSessions, attendance, grades, gradeItems, classGradeConfig, scaleBands, gradingScales, classes, terms, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(() => {
  const { db } = app.dbmod;
  db.delete(meritAwards).run();
  db.delete(meritCategories).run();
  db.delete(grades).run();
  db.delete(gradeItems).run();
  db.delete(classGradeConfig).run();
  db.delete(scaleBands).run();
  db.delete(gradingScales).run();
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

describe('categories', () => {
  it('ships editable defaults; admin can add/rename; only staff read', async () => {
    const admin = caller('admin');
    const defaults = await admin.merit.categoryList();
    expect(defaults.map((c) => c.name)).toEqual(['Ādāb', 'Sunnah practice', 'Hifz milestone', 'Helping others']);
    const { id } = await admin.merit.categoryCreate({ name: 'Punctuality', defaultPoints: 3 });
    await admin.merit.categoryUpdate({ id, defaultPoints: 4 });
    expect((await admin.merit.categoryList()).find((c) => c.id === id)?.defaultPoints).toBe(4);
    // finance/parent cannot read categories; teacher (staff) can.
    for (const r of ['finance', 'parent'] as const) await expect(caller(r).merit.categoryList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await caller('teacher', { userId: 'usr_t' }).merit.categoryList()).length).toBeGreaterThan(0);
    // category management is admin-only
    await expect(caller('teacher', { userId: 'usr_t' }).merit.categoryCreate({ name: 'X', defaultPoints: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('awarding + summary', () => {
  it('teacher awards + deducts in their class; totals + leaderboard reflect the sum', async () => {
    const { admin, classId, teacherId, s1, s2 } = await scenario();
    const cats = await admin.merit.categoryList();
    const adab = cats[0].id;
    const teacher = caller('teacher', { userId: teacherId });
    await teacher.merit.award({ classId, studentId: s1, categoryId: adab, points: 10 });
    await teacher.merit.award({ classId, studentId: s1, categoryId: adab, points: -3 }); // deduction
    await teacher.merit.award({ classId, studentId: s2, categoryId: adab, points: 5 });
    const sum = await teacher.merit.classSummary({ classId });
    expect(sum.students.find((r) => r.studentId === s1)?.total).toBe(7);
    expect(sum.students.find((r) => r.studentId === s2)?.total).toBe(5);
    expect(sum.students[0].studentId).toBe(s1); // leaderboard: highest first (7 > 5)
    expect(sum.recent).toHaveLength(3);
    // No per-student PII in the award audit detail.
    const a = app.dbmod.db.select().from(auditLog).all().find((x) => x.action === 'merit.award')!;
    expect(JSON.stringify(a.detail)).not.toContain(s1);
  });

  it('rejects awarding a student not enrolled in the class; award can be undone', async () => {
    const { admin, classId, s1 } = await scenario();
    const cats = await admin.merit.categoryList();
    const fam = await admin.people.familyCreate({ name: 'Out' });
    const outsider = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Z', lastName: 'Z' });
    await expect(admin.merit.award({ classId, studentId: outsider.id, categoryId: cats[0].id, points: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const { id } = await admin.merit.award({ classId, studentId: s1, categoryId: cats[0].id, points: 5 });
    await admin.merit.awardDelete({ id });
    expect((await admin.merit.classSummary({ classId })).students.find((r) => r.studentId === s1)?.total).toBe(0);
  });
});

describe('walls', () => {
  it('teacher cannot award in a class they don’t teach; finance/parent refused; admin over tunnel refused', async () => {
    const { admin, classId, s1 } = await scenario();
    const cats = await admin.merit.categoryList();
    const stranger = caller('teacher', { userId: 'usr_stranger' });
    await expect(stranger.merit.award({ classId, studentId: s1, categoryId: cats[0].id, points: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(stranger.merit.classSummary({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const r of ['finance', 'parent'] as const) {
      await expect(caller(r).merit.classSummary({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).merit.award({ classId, studentId: s1, categoryId: cats[0].id, points: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).merit.award({ classId, studentId: s1, categoryId: cats[0].id, points: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a teacher cannot delete an award in a class they don’t teach', async () => {
    const { admin, classId, s1 } = await scenario();
    const cats = await admin.merit.categoryList();
    const { id } = await admin.merit.award({ classId, studentId: s1, categoryId: cats[0].id, points: 5 });
    await expect(caller('teacher', { userId: 'usr_stranger' }).merit.awardDelete({ id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The award survives the refused delete.
    expect(app.dbmod.db.select().from(meritAwards).all()).toHaveLength(1);
  });
});
