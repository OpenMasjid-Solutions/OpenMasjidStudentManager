// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Term close → finals → transcripts (CLAUDE.md §4/§9): closing a term freezes each enrollment's
 * final grade into term_finals; the frozen value does NOT drift when scores change afterward;
 * reopening + re-closing recomputes it. A multi-term transcript is built ONLY from the frozen
 * finals. Plus the walls (close/reopen/transcript are admin-only; admin over tunnel refused).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { transcripts, termFinals, reportCards, termRemarks, examScores, examClassSubjects, examClasses, exams, attendance, classGradeConfig, scaleBands, gradingScales, enrollments, classTeachers, classSubjects, classSessions, grades, gradeItems, meritAwards, meritCategories, classes, terms, students, families, users, auditLog, settings } from '../src/db/schema';
import { freshApp, makeCtx } from './harness';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let buildTranscript: typeof import('../src/reports/transcript').buildTranscript;
let computeFinal: typeof import('../src/grades/final').computeFinal;
let buildReportCard: typeof import('../src/reports/aggregate').buildReportCard;

const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
  ({ buildTranscript } = await import('../src/reports/transcript'));
  ({ computeFinal } = await import('../src/grades/final'));
  ({ buildReportCard } = await import('../src/reports/aggregate'));
});

beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [transcripts, termFinals, reportCards, termRemarks, examScores, examClassSubjects, examClasses, exams, attendance, classGradeConfig, scaleBands, gradingScales, enrollments, classTeachers, classSubjects, classSessions, grades, gradeItems, meritAwards, meritCategories, classes, terms, students, families, users, auditLog, settings]) db.delete(t).run();
});

/** A term + class (madrasa scale) + one exam over subject 'Sabaq' (max 100). */
async function termClass(admin: ReturnType<typeof caller>, name: string) {
  const term = await admin.classes.termCreate({ name });
  const cls = await admin.classes.classCreate({ termId: term.id, name: `Class ${name}`, type: 'hifz' });
  await admin.classes.setSubjects({ classId: cls.id, subjects: ['Sabaq'] });
  const scales = await admin.grades.scaleList();
  await admin.grades.setClassScale({ classId: cls.id, scaleId: scales.find((s) => s.name === 'Mumtāz–Rāsib')!.id });
  const exam = await admin.exams.examCreate({ termId: term.id, name: 'Final' });
  await admin.exams.assignClass({ examId: exam.id, classId: cls.id });
  const subj = (await admin.exams.grid({ examId: exam.id, classId: cls.id })).subjects[0];
  return { termId: term.id, classId: cls.id, examId: exam.id, subjectId: subj.id };
}

describe('term close + finals freeze', () => {
  it('freezes finals at close; a later score change does not move them until re-close', async () => {
    const admin = caller('admin');
    const { termId, classId, examId, subjectId } = await termClass(admin, 'T1');
    const fam = await admin.people.familyCreate({ name: 'Fam' });
    const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Ayah', lastName: 'K' });
    await admin.classes.enroll({ classId, studentId: stu.id });
    await admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 85 });

    const res = await admin.classes.termClose({ id: termId });
    expect(res.finals).toBe(1);
    let finals = await admin.classes.termFinalsList({ termId });
    expect(finals[0]).toMatchObject({ studentId: stu.id, obtained: 85, max: 100, percentTenths: 850, band: 'Mumtāz' });

    // Editing marks while closed is blocked, so the frozen final can't drift.
    await expect(admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 40 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    finals = await admin.classes.termFinalsList({ termId });
    expect(finals[0].percentTenths).toBe(850); // still frozen at 85.0%

    // Reopen → change the mark → re-close recomputes.
    await admin.classes.termReopen({ id: termId });
    await admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 40 });
    await admin.classes.termClose({ id: termId });
    finals = await admin.classes.termFinalsList({ termId });
    expect(finals[0]).toMatchObject({ percentTenths: 400, band: 'Rāsib' }); // 40% now
    // Still exactly one frozen row (upsert, not duplicate).
    expect(app.dbmod.db.select().from(termFinals).all()).toHaveLength(1);
  });
});

describe('review fixes', () => {
  it('locks exam edits while the term is closed; reopening unlocks', async () => {
    const admin = caller('admin');
    const { termId, classId, examId, subjectId } = await termClass(admin, 'T1');
    const fam = await admin.people.familyCreate({ name: 'F' });
    const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'A', lastName: 'B' });
    await admin.classes.enroll({ classId, studentId: stu.id });
    await admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 70 });
    await admin.classes.termClose({ id: termId });
    await expect(admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 80 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await admin.classes.termReopen({ id: termId });
    await admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 80 }); // ok now
  });

  it('re-close drops finals for since-withdrawn enrollments (no stale transcript rows)', async () => {
    const admin = caller('admin');
    const { termId, classId } = await termClass(admin, 'T1');
    const fam = await admin.people.familyCreate({ name: 'F' });
    const s1 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'A', lastName: 'B' });
    const s2 = await admin.people.studentCreate({ familyId: fam.id, firstName: 'C', lastName: 'D' });
    await admin.classes.enroll({ classId, studentId: s1.id });
    await admin.classes.enroll({ classId, studentId: s2.id });
    await admin.classes.termClose({ id: termId });
    expect((await admin.classes.termFinalsList({ termId })).length).toBe(2);
    const d = await admin.classes.classGet({ id: classId });
    const enr = d.roster.find((r) => r.studentId === s2.id)!.enrollmentId;
    await admin.classes.termReopen({ id: termId });
    await admin.classes.unenroll({ enrollmentId: enr });
    await admin.classes.termClose({ id: termId });
    const finals = await admin.classes.termFinalsList({ termId });
    expect(finals.map((f) => f.studentId)).toEqual([s1.id]);
  });

  it('report-card overall equals the frozen final (one math source, §16)', async () => {
    const admin = caller('admin');
    const { classId, examId, subjectId } = await termClass(admin, 'T1');
    const fam = await admin.people.familyCreate({ name: 'F' });
    const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'A', lastName: 'B' });
    await admin.classes.enroll({ classId, studentId: stu.id });
    await admin.exams.setScore({ examId, classId, studentId: stu.id, subjectId, status: 'scored', value: 73 });
    const card = buildReportCard(stu.id, classId, { generatedAt: new Date(), version: 1 });
    const final = computeFinal(stu.id, classId);
    expect(card.overall.percent).toBe(final.percent);
    expect(card.overall.obtained).toBe(final.obtained);
    expect(card.overall.band).toBe(final.band);
  });
});

describe('multi-term transcript', () => {
  it('builds a cumulative transcript from frozen finals across two terms', async () => {
    const admin = caller('admin');
    const fam = await admin.people.familyCreate({ name: 'Fam' });
    const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'Yusuf', lastName: 'I' });

    const t1 = await termClass(admin, '2025 — T1');
    await admin.classes.enroll({ classId: t1.classId, studentId: stu.id });
    await admin.exams.setScore({ examId: t1.examId, classId: t1.classId, studentId: stu.id, subjectId: t1.subjectId, status: 'scored', value: 90 });
    await admin.classes.termClose({ id: t1.termId });

    const t2 = await termClass(admin, '2026 — T1');
    await admin.classes.enroll({ classId: t2.classId, studentId: stu.id });
    await admin.exams.setScore({ examId: t2.examId, classId: t2.classId, studentId: stu.id, subjectId: t2.subjectId, status: 'scored', value: 55 });
    await admin.classes.termClose({ id: t2.termId });

    const data = buildTranscript(stu.id, { generatedAt: new Date(), version: 1 });
    expect(data.terms.map((t) => t.termName)).toEqual(['2025 — T1', '2026 — T1']); // chronological
    expect(data.terms[0].rows[0]).toMatchObject({ percent: 90, band: 'Mumtāz' });
    expect(data.terms[1].rows[0]).toMatchObject({ percent: 55, band: 'Maqbūl' });

    // Generate the PDF + a v2, immutable versioning.
    await admin.reports.transcriptGenerate({ studentId: stu.id });
    await admin.reports.transcriptGenerate({ studentId: stu.id });
    const versions = await admin.reports.transcriptVersions({ studentId: stu.id });
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    // The v1 snapshot is frozen data (dataJson stored).
    const first = app.dbmod.db.select().from(transcripts).all().find((t) => t.version === 1)!;
    expect((first.dataJson as { terms: unknown[] }).terms).toHaveLength(2);
  });
});

describe('walls', () => {
  it('close/reopen/finals/transcript are admin-only; admin over tunnel refused', async () => {
    const admin = caller('admin');
    const { termId } = await termClass(admin, 'T1');
    const fam = await admin.people.familyCreate({ name: 'F' });
    const stu = await admin.people.studentCreate({ familyId: fam.id, firstName: 'A', lastName: 'B' });
    for (const r of ['teacher', 'finance', 'parent'] as const) {
      await expect(caller(r, { userId: `usr_${r}` }).classes.termClose({ id: termId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r, { userId: `usr_${r}` }).classes.termFinalsList({ termId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r, { userId: `usr_${r}` }).reports.transcriptGenerate({ studentId: stu.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).classes.termClose({ id: termId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('admin', { origin: 'tunnel' }).reports.transcriptGenerate({ studentId: stu.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
