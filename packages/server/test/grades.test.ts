// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Gradebook (CLAUDE.md §4/§5/§9): shipped default scales, custom scales + bands, per-class
 * scale, grade items, score entry (upsert/clear, over-max + duplicate + not-enrolled guards),
 * the grid's percent + band computation, the teacher wall, and audit (no PII).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { grades, gradeItems, classGradeConfig, scaleBands, gradingScales, enrollments, classTeachers, classSubjects, classSessions, attendance, classes, terms, students, families, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(() => {
  const { db } = app.dbmod;
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

describe('grading scales', () => {
  it('ships three editable defaults; admin can add a custom scale + bands', async () => {
    const admin = caller('admin');
    const defaults = await admin.grades.scaleList();
    expect(defaults.map((s) => s.name).sort()).toEqual(['A–F', 'Mumtāz–Rāsib', 'Percentage']);
    const { id } = await admin.grades.scaleCreate({ name: 'Pass/Fail', bands: [{ label: 'Pass', minPercent: 50 }, { label: 'Fail', minPercent: 0 }] });
    await admin.grades.setBands({ scaleId: id, bands: [{ label: 'Pass', minPercent: 40 }, { label: 'Fail', minPercent: 0 }] });
    const list = await admin.grades.scaleList();
    const pf = list.find((s) => s.id === id)!;
    expect(pf.bands.find((b) => b.label === 'Pass')?.minPercent).toBe(40);
  });

  it('scales are admin-only', async () => {
    for (const r of ['teacher', 'finance', 'parent'] as const) {
      await expect(caller(r).grades.scaleList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('grade items + scores + grid', () => {
  it('teacher enters scores; grid computes total-points percent and the class scale band', async () => {
    const { admin, classId, teacherId, s1, s2 } = await scenario();
    // Use the madrasa scale for this class.
    const scales = await admin.grades.scaleList();
    const madrasa = scales.find((s) => s.name === 'Mumtāz–Rāsib')!;
    await admin.grades.setClassScale({ classId, scaleId: madrasa.id });

    const teacher = caller('teacher', { userId: teacherId });
    const item = await teacher.grades.itemCreate({ classId, title: 'Surah test', maxPoints: 10 });
    await teacher.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: 8.5 }, { studentId: s2, points: 5.5 }] });

    const grid = await teacher.grades.grid({ classId });
    const row1 = grid.students.find((r) => r.studentId === s1)!;
    const row2 = grid.students.find((r) => r.studentId === s2)!;
    expect(row1.scores[item.id]).toBe(8.5);
    expect(row1.percent).toBe(85);
    expect(row1.band).toBe('Mumtāz'); // 85 >= 80
    expect(row2.percent).toBe(55);
    expect(row2.band).toBe('Maqbūl'); // 55 in [50,60)
    expect(grid.items[0].avgPercent).toBe(70); // (85+55)/2
  });

  it('scores upsert, clear (null), and reject over-max / duplicate / not-enrolled', async () => {
    const { admin, classId, s1, s2 } = await scenario();
    const item = await admin.grades.itemCreate({ classId, title: 'Quiz', maxPoints: 10 });
    await admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: 7 }] });
    await admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: 9 }] }); // update
    let grid = await admin.grades.grid({ classId });
    expect(grid.students.find((r) => r.studentId === s1)!.scores[item.id]).toBe(9);
    expect(app.dbmod.db.select().from(grades).all()).toHaveLength(1); // upsert, not duplicate
    await admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: null }] }); // clear
    grid = await admin.grades.grid({ classId });
    expect(grid.students.find((r) => r.studentId === s1)!.scores[item.id]).toBeUndefined();
    await expect(admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s2, points: 11 }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' }); // over max
    await expect(admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s2, points: 1 }, { studentId: s2, points: 2 }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' }); // dup
    const fam = await admin.people.familyCreate({ name: 'Out' });
    const outsider = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Z', lastName: 'Z' });
    await expect(admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: outsider.id, points: 1 }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' }); // not enrolled
  });

  it('refuses to lower an assignment max below an already-entered score', async () => {
    const { admin, classId, s1 } = await scenario();
    const item = await admin.grades.itemCreate({ classId, title: 'Test', maxPoints: 100 });
    await admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: 90 }] });
    await expect(admin.grades.itemUpdate({ id: item.id, maxPoints: 50 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Raising the max (or lowering to >= the top score) is fine.
    await admin.grades.itemUpdate({ id: item.id, maxPoints: 90 });
    const grid = await admin.grades.grid({ classId });
    expect(grid.students.find((r) => r.studentId === s1)!.percent).toBe(100); // 90/90
  });

  it('deleting an assignment cascades its scores', async () => {
    const { admin, classId, s1 } = await scenario();
    const item = await admin.grades.itemCreate({ classId, title: 'Q', maxPoints: 5 });
    await admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: 4 }] });
    await admin.grades.itemDelete({ id: item.id });
    expect(app.dbmod.db.select().from(grades).all()).toHaveLength(0);
  });
});

describe('teacher wall + origin', () => {
  it('a teacher cannot touch a class they are not assigned to; finance/parent refused; admin over tunnel refused', async () => {
    const { admin, classId } = await scenario();
    const stranger = caller('teacher', { userId: 'usr_stranger' });
    await expect(stranger.grades.itemCreate({ classId, title: 'X', maxPoints: 10 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(stranger.grades.grid({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const r of ['finance', 'parent'] as const) {
      await expect(caller(r).grades.grid({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).grades.itemCreate({ classId, title: 'X', maxPoints: 10 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // setClassScale is admin-only
    await expect(caller('teacher', { userId: 'usr_x' }).grades.setClassScale({ classId, scaleId: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a score save is audited without per-student PII', async () => {
    const { admin, classId, s1 } = await scenario();
    const item = await admin.grades.itemCreate({ classId, title: 'Q', maxPoints: 10 });
    await admin.grades.setScores({ classId, gradeItemId: item.id, entries: [{ studentId: s1, points: 8 }] });
    const audits = app.dbmod.db.select().from(auditLog).all().filter((a) => a.action === 'grades.set');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].detail)).not.toContain(s1);
  });
});
