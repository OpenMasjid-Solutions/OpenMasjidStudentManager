// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report-card data aggregation (CLAUDE.md §4): for a student in a class+term, build the
 * per-subject marks across the term's exams, totals + percentage + the class's scale band,
 * an attendance summary, an optional merit total, and the teacher's term remark. Pure reads;
 * the PDF template + generator consume this shape. Absent counts as 0 toward the total; exempt
 * is excluded from both obtained and max (standard madrasa handling).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { classes, terms, students, attendance, meritAwards, termRemarks } from '../db/schema';
import { aggregateExamMarks } from '../grades/final';
import { getSchoolName, getMeritOnReportCard } from '../settings';

const CLASS_TYPE_LABEL: Record<string, string> = { maktab: 'Maktab', hifz: 'Hifz', nazrah: 'Nazrah', alim: 'ʿĀlim course', custom: 'Class' };
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ReportCardData {
  school: string;
  term: string;
  className: string;
  classType: string;
  studentName: string;
  exams: { id: string; name: string }[];
  rows: { subject: string; cells: { display: string; scored: boolean }[]; obtained: number; max: number }[];
  overall: { obtained: number; max: number; percent: number | null; band: string | null };
  attendance: { present: number; absent: number; late: number; excused: number; total: number; percent: number | null };
  meritTotal: number | null;
  remark: string | null;
  generatedAt: Date;
  version: number;
}

export function buildReportCard(studentId: string, classId: string, opts: { generatedAt: Date; version: number }): ReportCardData {
  const cls = db.select().from(classes).where(eq(classes.id, classId)).get();
  if (!cls) throw new Error('class not found');
  const student = db.select().from(students).where(eq(students.id, studentId)).get();
  if (!student) throw new Error('student not found');
  const term = db.select().from(terms).where(eq(terms.id, cls.termId)).get();

  // Marks matrix + totals + band — the single source of truth (grades/final.ts), shared with
  // term-close's computeFinal so the report card and the frozen final never diverge.
  const marks = aggregateExamMarks(studentId, classId);
  const examCols = marks.exams;
  const rows = marks.rows;
  const totObtained = marks.obtained;
  const totMax = marks.max;
  const percent = marks.rawPercent !== null ? round1(marks.rawPercent) : null;
  const band = marks.band;

  // Attendance summary for the class.
  const att = db.select({ status: attendance.status }).from(attendance).where(and(eq(attendance.classId, classId), eq(attendance.studentId, studentId))).all();
  const count = (s: string) => att.filter((a) => a.status === s).length;
  const present = count('present');
  const absent = count('absent');
  const late = count('late');
  const excused = count('excused');
  const attTotal = att.length;

  const meritTotal = getMeritOnReportCard()
    ? db.select({ points: meritAwards.points }).from(meritAwards).where(and(eq(meritAwards.classId, classId), eq(meritAwards.studentId, studentId))).all().reduce((a, r) => a + r.points, 0)
    : null;

  const remark = db.select({ remark: termRemarks.remark }).from(termRemarks).where(and(eq(termRemarks.classId, classId), eq(termRemarks.studentId, studentId))).get()?.remark ?? null;

  return {
    school: getSchoolName(),
    term: term?.name ?? '',
    className: cls.name,
    classType: cls.type === 'custom' ? cls.customLabel || 'Class' : CLASS_TYPE_LABEL[cls.type] ?? cls.type,
    studentName: `${student.firstName} ${student.lastName}`,
    exams: examCols,
    rows,
    overall: { obtained: totObtained, max: totMax, percent, band },
    attendance: { present, absent, late, excused, total: attTotal, percent: attTotal > 0 ? round1((present / attTotal) * 100) : null },
    meritTotal,
    remark,
    generatedAt: opts.generatedAt,
    version: opts.version,
  };
}
