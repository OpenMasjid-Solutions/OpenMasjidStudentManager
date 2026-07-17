// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report cards (CLAUDE.md §4/§5/§9/§14): the aggregation math (marks matrix, absent-counts-as-0,
 * exempt-excluded, percent + scale band, attendance, remark), immutable versioned generation
 * against a full-class fixture (incl. a v2 regeneration), publish, and the walls (generate/publish
 * admin-only; teacher reads own class; finance/parent refused; admin over tunnel refused).
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { reportCards, termRemarks, examScores, examClassSubjects, examClasses, exams, attendance, classGradeConfig, scaleBands, gradingScales, enrollments, classTeachers, classSubjects, classSessions, grades, gradeItems, meritAwards, meritCategories, classes, terms, students, families, users, auditLog, settings } from '../src/db/schema';
import { freshApp, makeCtx } from './harness';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let buildReportCard: typeof import('../src/reports/aggregate').buildReportCard;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
  ({ buildReportCard } = await import('../src/reports/aggregate'));
});

beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [reportCards, termRemarks, examScores, examClassSubjects, examClasses, exams, attendance, classGradeConfig, scaleBands, gradingScales, enrollments, classTeachers, classSubjects, classSessions, grades, gradeItems, meritAwards, meritCategories, classes, terms, students, families, users, auditLog, settings]) db.delete(t).run();
});

/** A term, a class with 2 subjects + the madrasa scale, a teacher, 2 enrolled students, one exam. */
async function fixture() {
  const admin = caller('admin');
  const term = await admin.classes.termCreate({ name: 'T1', isCurrent: true });
  const cls = await admin.classes.classCreate({ termId: term.id, name: 'Hifz A', type: 'hifz' });
  await admin.classes.setSubjects({ classId: cls.id, subjects: ['Sabaq', 'Manzil'] });
  const scales = await admin.grades.scaleList();
  await admin.grades.setClassScale({ classId: cls.id, scaleId: scales.find((s) => s.name === 'Mumtāz–Rāsib')!.id });
  const { id: teacherId } = await admin.staff.create({ username: 'ustadh', role: 'teacher', tempPassword: 'temp-pass-1234' });
  await admin.classes.assignTeacher({ classId: cls.id, userId: teacherId });
  const fam = await admin.people.familyCreate({ name: 'Fam' });
  const s1 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Ayah', lastName: 'K' });
  const s2 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Bilal', lastName: 'K' });
  await admin.classes.enroll({ classId: cls.id, studentId: s1.id });
  await admin.classes.enroll({ classId: cls.id, studentId: s2.id });
  const exam = await admin.exams.examCreate({ termId: term.id, name: 'Final' });
  await admin.exams.assignClass({ examId: exam.id, classId: cls.id });
  const g = await admin.exams.grid({ examId: exam.id, classId: cls.id });
  const sabaq = g.subjects.find((s) => s.name === 'Sabaq')!;
  const manzil = g.subjects.find((s) => s.name === 'Manzil')!;
  // s1: Sabaq 85, Manzil absent → 85/200 = 42.5% (Rāsib). s2: Sabaq 90, Manzil exempt → 90/100 = 90% (Mumtāz).
  await admin.exams.setScore({ examId: exam.id, classId: cls.id, studentId: s1.id, subjectId: sabaq.id, status: 'scored', value: 85 });
  await admin.exams.setScore({ examId: exam.id, classId: cls.id, studentId: s1.id, subjectId: manzil.id, status: 'absent' });
  await admin.exams.setScore({ examId: exam.id, classId: cls.id, studentId: s2.id, subjectId: sabaq.id, status: 'scored', value: 90 });
  await admin.exams.setScore({ examId: exam.id, classId: cls.id, studentId: s2.id, subjectId: manzil.id, status: 'exempt' });
  await admin.exams.setRemark({ classId: cls.id, studentId: s1.id, remark: 'Strong term.' });
  await admin.attendance.mark({ classId: cls.id, date: '2026-03-02', clientToday: '2026-03-05', entries: [{ studentId: s1.id, status: 'present' }, { studentId: s2.id, status: 'late' }] });
  return { admin, teacherId, classId: cls.id, termId: term.id, s1: s1.id, s2: s2.id };
}

describe('aggregation', () => {
  it('computes the marks matrix, absent→0, exempt excluded, percent + band, attendance, remark', async () => {
    const { classId, s1, s2 } = await fixture();
    const a = buildReportCard(s1, classId, { generatedAt: new Date(), version: 1 });
    expect(a.exams.map((e) => e.name)).toEqual(['Final']);
    expect(a.rows.find((r) => r.subject === 'Sabaq')).toMatchObject({ obtained: 85, max: 100 });
    const manzil = a.rows.find((r) => r.subject === 'Manzil')!;
    expect(manzil.cells[0].display).toBe('Abs');
    expect(manzil.max).toBe(100); // absent counts toward max
    expect(a.overall).toMatchObject({ obtained: 85, max: 200, percent: 42.5, band: 'Rāsib' });
    expect(a.attendance).toMatchObject({ present: 1, total: 1 });
    expect(a.remark).toBe('Strong term.');

    const b = buildReportCard(s2, classId, { generatedAt: new Date(), version: 1 });
    const bManzil = b.rows.find((r) => r.subject === 'Manzil')!;
    expect(bManzil.cells[0].display).toBe('Exc');
    expect(bManzil.max).toBe(0); // exempt excluded from max
    expect(b.overall).toMatchObject({ obtained: 90, max: 100, percent: 90, band: 'Mumtāz' });
  });

  it('bands on the exact ratio, not the rounded display percent (no boundary promotion)', async () => {
    const { admin, classId, termId, s1 } = await fixture();
    // A second exam whose single subject max is 10000 → a 79.96% that rounds to 80.0 for display.
    const exam2 = await admin.exams.examCreate({ termId, name: 'Precision' });
    // Re-point: use a fresh class so only this exam counts, keeping the math clean.
    const cls2 = await admin.classes.classCreate({ termId, name: 'Solo', type: 'alim' });
    await admin.classes.setSubjects({ classId: cls2.id, subjects: ['Fiqh'] });
    const scales = await admin.grades.scaleList();
    await admin.grades.setClassScale({ classId: cls2.id, scaleId: scales.find((x) => x.name === 'Mumtāz–Rāsib')!.id });
    const fam = await admin.people.familyCreate({ name: 'Solo fam' });
    const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Zaid', lastName: 'S' });
    await admin.classes.enroll({ classId: cls2.id, studentId: stu.id });
    await admin.exams.assignClass({ examId: exam2.id, classId: cls2.id });
    const g = await admin.exams.grid({ examId: exam2.id, classId: cls2.id });
    const fiqh = g.subjects[0];
    await admin.exams.setSubjectMax({ subjectId: fiqh.id, maxMarks: 10000 });
    await admin.exams.setScore({ examId: exam2.id, classId: cls2.id, studentId: stu.id, subjectId: fiqh.id, status: 'scored', value: 7996 });
    const a = buildReportCard(stu.id, cls2.id, { generatedAt: new Date(), version: 1 });
    expect(a.overall.percent).toBe(80); // rounds up for display
    expect(a.overall.band).toBe('Jayyid Jiddan'); // but 79.96% < 80 → NOT promoted to Mumtāz
    void s1;
  });
});

describe('generation + versioning + publish', () => {
  it('generates a card per student, files land on disk, regeneration bumps the version, publish sets published', async () => {
    const { admin, classId, s1 } = await fixture();
    const res = await admin.reports.generateClass({ classId });
    expect(res.count).toBe(2);
    let list = await admin.reports.list({ classId });
    expect(list.every((r) => r.latest?.version === 1)).toBe(true);
    // The PDF files exist and are non-trivial.
    const { db } = app.dbmod;
    const cards = db.select().from(reportCards).all();
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      const p = path.join(process.env.DATA_DIR!, 'reports', c.pdfPath);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(1000);
    }
    // Regenerate one student → v2 (immutable: two rows now for that student).
    await admin.reports.generateStudent({ classId, studentId: s1 });
    const v = await admin.reports.versions({ classId, studentId: s1 });
    expect(v.map((x) => x.version)).toEqual([2, 1]);
    list = await admin.reports.list({ classId });
    expect(list.find((r) => r.studentId === s1)?.latest?.version).toBe(2);
    // Publish the class's latest cards.
    await admin.reports.publishClass({ classId, published: true });
    list = await admin.reports.list({ classId });
    expect(list.every((r) => r.latest?.publishedAt)).toBe(true);
  });

  it('stores a frozen data snapshot on each card that later score changes do NOT alter', async () => {
    const { admin, classId, termId, s1 } = await fixture();
    await admin.reports.generateStudent({ classId, studentId: s1 });
    const { db } = app.dbmod;
    const before = db.select().from(reportCards).where(eq(reportCards.studentId, s1)).all().sort((a, b) => b.version - a.version)[0];
    const snap = before.dataJson as { overall: { obtained: number } };
    expect(snap.overall.obtained).toBe(85);
    // Change the exam score afterwards; the filed snapshot must be unchanged (immutable version).
    const exam = db.select().from(exams).where(eq(exams.termId, termId)).all()[0];
    const ec = db.select().from(examClasses).where(and(eq(examClasses.examId, exam.id), eq(examClasses.classId, classId))).get()!;
    const sabaq = db.select().from(examClassSubjects).where(eq(examClassSubjects.examClassId, ec.id)).all().find((x) => x.name === 'Sabaq')!;
    await admin.exams.setScore({ examId: exam.id, classId, studentId: s1, subjectId: sabaq.id, status: 'scored', value: 10 });
    const after = db.select().from(reportCards).where(eq(reportCards.id, before.id)).get()!;
    expect((after.dataJson as { overall: { obtained: number } }).overall.obtained).toBe(85); // still the filed value
  });
});

describe('walls', () => {
  it('generate/publish are admin-only; teacher reads own class; finance/parent refused; admin over tunnel refused', async () => {
    const { classId, teacherId, s1 } = await fixture();
    const teacher = caller('teacher', { userId: teacherId });
    // teacher can read the list for their class, but cannot generate/publish
    expect((await teacher.reports.list({ classId })).length).toBe(2);
    await expect(teacher.reports.generateClass({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(teacher.reports.publishClass({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // a teacher not assigned can't even read
    await expect(caller('teacher', { userId: 'usr_stranger' }).reports.list({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const r of ['finance', 'parent'] as const) {
      await expect(caller(r).reports.list({ classId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).reports.generateStudent({ classId, studentId: s1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('generating for a non-enrolled student returns a friendly NOT_FOUND, not an opaque error', async () => {
    const { admin, classId } = await fixture();
    const fam = await admin.people.familyCreate({ name: 'Out' });
    const outsider = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Q', lastName: 'Z' });
    await expect(admin.reports.generateStudent({ classId, studentId: outsider.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
