// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Exams (CLAUDE.md §4/§5/§9): exam definitions, class assignment + the subject SNAPSHOT (edits
 * to the class's live subjects never touch a past exam), per-subject max marks, the score grid
 * (scored / absent / exempt / clear + guards), term remarks, the completion dashboard, and the
 * teacher wall (own classes only; finance/parent refused; admin over tunnel refused).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { termRemarks, examScores, examClassSubjects, examClasses, exams, enrollments, classTeachers, classSubjects, classSessions, attendance, grades, gradeItems, classGradeConfig, scaleBands, gradingScales, meritAwards, meritCategories, classes, terms, students, families, users, auditLog } from '../src/db/schema';
import { freshApp, makeCtx } from './harness';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [termRemarks, examScores, examClassSubjects, examClasses, exams, meritAwards, meritCategories, grades, gradeItems, classGradeConfig, scaleBands, gradingScales, attendance, enrollments, classTeachers, classSubjects, classSessions, classes, terms, students, families, users, auditLog]) db.delete(t).run();
});

async function scenario() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Hifz A', type: 'hifz' });
  await admin.classes.setSubjects({ classId: cls.id, subjects: ['Sabaq', 'Manzil'] });
  const { id: teacherId } = await admin.staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
  await admin.classes.assignTeacher({ classId: cls.id, userId: teacherId });
  const fam = await admin.people.familyCreate({ name: 'Fam' });
  const s1 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Ayah', lastName: 'K' });
  const s2 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Bilal', lastName: 'K' });
  await admin.classes.enroll({ classId: cls.id, studentId: s1.id });
  await admin.classes.enroll({ classId: cls.id, studentId: s2.id });
  return { admin, termId: term.id, classId: cls.id, teacherId, s1: s1.id, s2: s2.id };
}

describe('definitions + assignment snapshot', () => {
  it('assigning snapshots the class subjects; later subject edits don’t change the exam', async () => {
    const { admin, termId, classId } = await scenario();
    const exam = await admin.exams.examCreate({ termId, name: 'Mid-Term' });
    await admin.exams.assignClass({ examId: exam.id, classId });
    const grid1 = await admin.exams.grid({ examId: exam.id, classId });
    expect(grid1.subjects.map((s) => s.name)).toEqual(['Sabaq', 'Manzil']);
    // Change the class's live subjects — the exam's snapshot must be unchanged.
    await admin.classes.setSubjects({ classId, subjects: ['Sabaq', 'Manzil', 'Tajwīd', 'Extra'] });
    const grid2 = await admin.exams.grid({ examId: exam.id, classId });
    expect(grid2.subjects.map((s) => s.name)).toEqual(['Sabaq', 'Manzil']);
  });

  it('per-subject max marks default 100 and are editable; can’t drop below an entered mark', async () => {
    const { admin, termId, classId, s1 } = await scenario();
    const exam = await admin.exams.examCreate({ termId, name: 'Final' });
    await admin.exams.assignClass({ examId: exam.id, classId });
    const grid = await admin.exams.grid({ examId: exam.id, classId });
    const sabaq = grid.subjects.find((s) => s.name === 'Sabaq')!;
    expect(sabaq.maxMarks).toBe(100);
    await admin.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: sabaq.id, status: 'scored', value: 80 });
    await expect(admin.exams.setSubjectMax({ subjectId: sabaq.id, maxMarks: 50 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await admin.exams.setSubjectMax({ subjectId: sabaq.id, maxMarks: 90 });
    expect((await admin.exams.grid({ examId: exam.id, classId })).subjects.find((s) => s.id === sabaq.id)?.maxMarks).toBe(90);
  });
});

describe('score entry + completion', () => {
  it('records scored/absent/exempt, rejects over-max, clears, and tracks completion', async () => {
    const { admin, termId, classId, teacherId, s1, s2 } = await scenario();
    const exam = await admin.exams.examCreate({ termId, name: 'Mid-Term' });
    await admin.exams.assignClass({ examId: exam.id, classId });
    const teacher = caller('teacher', { userId: teacherId });
    const g = await teacher.exams.grid({ examId: exam.id, classId });
    const [sabaq, manzil] = g.subjects;
    expect(g.progress.total).toBe(4); // 2 students × 2 subjects
    await teacher.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: sabaq.id, status: 'scored', value: 85 });
    await teacher.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: manzil.id, status: 'absent' });
    await teacher.exams.setScore({ examId: exam.id, classId, studentId: s2, subjectId: sabaq.id, status: 'exempt' });
    await expect(teacher.exams.setScore({ examId: exam.id, classId, studentId: s2, subjectId: manzil.id, status: 'scored', value: 200 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    let g2 = await teacher.exams.grid({ examId: exam.id, classId });
    expect(g2.progress.entered).toBe(3);
    expect(g2.scores[`${s1}|${sabaq.id}`]).toEqual({ status: 'scored', value: 85 });
    expect(g2.scores[`${s1}|${manzil.id}`]).toEqual({ status: 'absent', value: null });
    // Clear one back to blank.
    await teacher.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: sabaq.id, status: 'clear' });
    g2 = await teacher.exams.grid({ examId: exam.id, classId });
    expect(g2.progress.entered).toBe(2);
    // Admin completion dashboard reflects it.
    const comp = await admin.exams.completion({ examId: exam.id });
    expect(comp[0]).toMatchObject({ classId, enrolled: 2, subjectCount: 2, total: 4, entered: 2 });
  });

  it('term remark upserts and clears', async () => {
    const { admin, termId, classId, teacherId, s1 } = await scenario();
    const exam = await admin.exams.examCreate({ termId, name: 'Final' });
    await admin.exams.assignClass({ examId: exam.id, classId });
    const teacher = caller('teacher', { userId: teacherId });
    await teacher.exams.setRemark({ classId, studentId: s1, remark: 'Mashā’Allāh, strong progress.' });
    expect((await teacher.exams.grid({ examId: exam.id, classId })).remarks[s1]).toContain('strong progress');
    await teacher.exams.setRemark({ classId, studentId: s1, remark: '' });
    expect((await teacher.exams.grid({ examId: exam.id, classId })).remarks[s1]).toBeUndefined();
  });
});

describe('walls', () => {
  it('definitions are admin-only; score entry is scoped; finance/parent + admin-tunnel refused', async () => {
    const { admin, termId, classId, s1 } = await scenario();
    const exam = await admin.exams.examCreate({ termId, name: 'Mid-Term' });
    await admin.exams.assignClass({ examId: exam.id, classId });
    const grid = await admin.exams.grid({ examId: exam.id, classId });
    const subj = grid.subjects[0].id;
    // non-admin can't define/assign
    for (const r of ['teacher', 'finance', 'parent'] as const) {
      await expect(caller(r, { userId: `usr_${r}` }).exams.examCreate({ termId, name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r, { userId: `usr_${r}` }).exams.completion({ examId: exam.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    // teacher not assigned to the class can't grade or read the grid
    const stranger = caller('teacher', { userId: 'usr_stranger' });
    await expect(stranger.exams.grid({ examId: exam.id, classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(stranger.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: subj, status: 'scored', value: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // finance/parent can't touch score entry either
    for (const r of ['finance', 'parent'] as const) {
      await expect(caller(r).exams.grid({ examId: exam.id, classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    // admin over the tunnel is refused
    await expect(caller('admin', { origin: 'tunnel' }).exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: subj, status: 'absent' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // score audit carries no student id
    await admin.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: subj, status: 'scored', value: 5 });
    const a = app.dbmod.db.select().from(auditLog).all().find((x) => x.action === 'exam.score')!;
    expect(JSON.stringify(a.detail)).not.toContain(s1);
  });
});
