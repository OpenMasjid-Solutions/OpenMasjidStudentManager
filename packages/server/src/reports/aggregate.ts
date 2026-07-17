// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report-card data aggregation (CLAUDE.md §4): for a student in a class+term, build the
 * per-subject marks across the term's exams, totals + percentage + the class's scale band,
 * an attendance summary, an optional merit total, and the teacher's term remark. Pure reads;
 * the PDF template + generator consume this shape. Absent counts as 0 toward the total; exempt
 * is excluded from both obtained and max (standard madrasa handling).
 */
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { classes, terms, students, exams, examClasses, examClassSubjects, examScores, classGradeConfig, scaleBands, attendance, meritAwards, termRemarks } from '../db/schema';
import { bandFor } from '../grades/scales';
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

  // The term's exams assigned to this class, in order.
  const ecs = db
    .select({ ecId: examClasses.id, examId: examClasses.id, name: exams.name, examRealId: exams.id, position: exams.position, createdAt: exams.createdAt })
    .from(examClasses)
    .innerJoin(exams, eq(exams.id, examClasses.examId))
    .where(and(eq(examClasses.classId, classId), eq(exams.status, 'active')))
    .orderBy(asc(exams.position), asc(exams.createdAt))
    .all();

  const examCols = ecs.map((e) => ({ id: e.examRealId, name: e.name }));

  // Subjects (union across the exams' snapshots, in first-appearance order) → rows.
  const subjectOrder: string[] = [];
  // Per exam: subjectId list + this student's scores keyed by subjectId.
  const perExam = ecs.map((ec) => {
    const subs = db.select({ id: examClassSubjects.id, name: examClassSubjects.name, maxMarks: examClassSubjects.maxMarks, position: examClassSubjects.position }).from(examClassSubjects).where(eq(examClassSubjects.examClassId, ec.ecId)).orderBy(asc(examClassSubjects.position)).all();
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

  const totObtained = rows.reduce((a, r) => a + r.obtained, 0);
  const totMax = rows.reduce((a, r) => a + r.max, 0);
  const rawPercent = totMax > 0 ? (totObtained / totMax) * 100 : null; // exact — for banding
  const percent = rawPercent !== null ? round1(rawPercent) : null; // rounded — for display

  // Class scale band — from the exact ratio, so a score just under a cutoff (79.96%) isn't
  // promoted into the higher band by display rounding.
  const cfg = db.select().from(classGradeConfig).where(eq(classGradeConfig.classId, classId)).get();
  const bands = cfg?.scaleId ? db.select({ label: scaleBands.label, minPercent: scaleBands.minPercent }).from(scaleBands).where(eq(scaleBands.scaleId, cfg.scaleId)).all() : [];
  const band = rawPercent !== null ? bandFor(bands, rawPercent) : null;

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
