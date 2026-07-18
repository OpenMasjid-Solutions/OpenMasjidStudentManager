// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Final-grade math (CLAUDE.md §4/§16) — ONE place, used by both the report card (preview) and
 * term close (the frozen final). v1 combines the term's exams into a total-points percentage,
 * banded by the class's grading scale; absent counts 0 toward the max, exempt is excluded. (A
 * configurable weighted formula — coursework categories + exam weight — is a later enhancement;
 * this function is where it will slot in, so callers never re-derive the grade ad hoc.)
 */
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { classes, exams, examClasses, examClassSubjects, examScores, classGradeConfig, scaleBands, gradingScales } from '../db/schema';
import { bandFor } from './scales';

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ExamMarks {
  exams: { id: string; name: string }[];
  rows: { subject: string; cells: { display: string; scored: boolean }[]; obtained: number; max: number }[];
  obtained: number;
  max: number;
  rawPercent: number | null;
  band: string | null;
  scaleName: string | null;
}

/** The per-subject × per-exam marks matrix for a student in a class, plus totals + band. Shared
 *  by the report-card aggregator (for the matrix + overall) and computeFinal (for the number). */
export function aggregateExamMarks(studentId: string, classId: string): ExamMarks {
  const empty: ExamMarks = { exams: [], rows: [], obtained: 0, max: 0, rawPercent: null, band: null, scaleName: null };
  const cls = db.select({ termId: classes.termId }).from(classes).where(eq(classes.id, classId)).get();
  if (!cls) return empty;

  const ecs = db
    .select({ ecId: examClasses.id, examId: exams.id, name: exams.name })
    .from(examClasses)
    .innerJoin(exams, eq(exams.id, examClasses.examId))
    .where(and(eq(examClasses.classId, classId), eq(exams.status, 'active')))
    .orderBy(asc(exams.position), asc(exams.createdAt))
    .all();
  const examCols = ecs.map((e) => ({ id: e.examId, name: e.name }));

  const subjectOrder: string[] = [];
  const perExam = ecs.map((ec) => {
    const subs = db.select({ id: examClassSubjects.id, name: examClassSubjects.name, maxMarks: examClassSubjects.maxMarks }).from(examClassSubjects).where(eq(examClassSubjects.examClassId, ec.ecId)).orderBy(asc(examClassSubjects.position)).all();
    for (const s of subs) if (!subjectOrder.includes(s.name)) subjectOrder.push(s.name);
    const scoreRows = db.select().from(examScores).where(and(eq(examScores.examClassId, ec.ecId), eq(examScores.studentId, studentId))).all();
    const bySubjectName = new Map<string, { status: 'scored' | 'absent' | 'exempt'; value: number | null; max: number }>();
    for (const s of subs) {
      const sc = scoreRows.find((r) => r.subjectId === s.id);
      if (sc) bySubjectName.set(s.name, { status: sc.status, value: sc.value, max: s.maxMarks });
    }
    return { bySubjectName };
  });

  const rows = subjectOrder.map((subject) => {
    let obtained = 0;
    let max = 0;
    const cells = perExam.map((pe) => {
      const cell = pe.bySubjectName.get(subject);
      if (!cell) return { display: '—', scored: false };
      if (cell.status === 'exempt') return { display: 'Exc', scored: false };
      if (cell.status === 'absent') { max += cell.max; return { display: 'Abs', scored: false }; }
      obtained += cell.value ?? 0;
      max += cell.max;
      return { display: String(cell.value ?? 0), scored: true };
    });
    return { subject, cells, obtained, max };
  });

  const obtained = rows.reduce((a, r) => a + r.obtained, 0);
  const max = rows.reduce((a, r) => a + r.max, 0);
  const rawPercent = max > 0 ? (obtained / max) * 100 : null;

  const cfg = db.select().from(classGradeConfig).where(eq(classGradeConfig.classId, classId)).get();
  const bands = cfg?.scaleId ? db.select({ label: scaleBands.label, minPercent: scaleBands.minPercent }).from(scaleBands).where(eq(scaleBands.scaleId, cfg.scaleId)).all() : [];
  const scaleName = cfg?.scaleId ? db.select({ name: gradingScales.name }).from(gradingScales).where(eq(gradingScales.id, cfg.scaleId)).get()?.name ?? null : null;
  const band = rawPercent !== null ? bandFor(bands, rawPercent) : null;

  return { exams: examCols, rows, obtained, max, rawPercent, band, scaleName };
}

export interface FinalGrade {
  obtained: number;
  max: number;
  percent: number | null; // rounded to 1 dp for display; band is computed from the exact ratio
  band: string | null;
  scaleName: string | null;
}

/** The authoritative final grade for a student in a class (term close + preview use this). */
export function computeFinal(studentId: string, classId: string): FinalGrade {
  const m = aggregateExamMarks(studentId, classId);
  return { obtained: m.obtained, max: m.max, percent: m.rawPercent !== null ? round1(m.rawPercent) : null, band: m.band, scaleName: m.scaleName };
}
