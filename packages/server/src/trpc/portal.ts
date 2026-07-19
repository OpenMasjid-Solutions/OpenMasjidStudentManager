// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Parent portal reads (CLAUDE.md §4, §5) — the parent-facing lens, scoped to the caller's own
 * families via guardian_users (§14: scoping in the query, never the UI). Read-only in this slice:
 * the family's kids (with their PINs — parents may see their own kids' PINs), the derived balance,
 * open invoices, and the unified payment history. Grades / schedule / merit / attendance / report
 * cards land in later slices. Every value crosses through parentProcedure (LAN + tunnel).
 */
import { z } from 'zod';
import { and, eq, asc, desc, inArray } from 'drizzle-orm';
import { router, parentProcedure } from './trpc';
import { db } from '../db';
import { families, students, invoices, payments, reportCards, transcripts, classes, classSessions, enrollments, gradeItems, grades, attendance, meritAwards, meritCategories } from '../db/schema';
import { familyBalance, invoiceTotal, invoicePaid } from '../billing/ledger';
import { getCurrency } from '../settings';
import { parentFamilyIds, parentStudentIds, assertStudentAccess } from './familyAccess';

const STUDENT = z.object({ studentId: z.string().min(1).max(64) });

export const portalRouter = router({
  /** Everything the My-Family home needs, for each family this parent is linked to. */
  myFamily: parentProcedure.query(({ ctx }) => {
    const currency = getCurrency();
    const famIds = parentFamilyIds(ctx);
    if (!famIds.length) return { currency, families: [] as FamilyView[] };

    const list: FamilyView[] = famIds.map((fid) => {
      const fam = db.select({ id: families.id, name: families.name }).from(families).where(eq(families.id, fid)).get();
      const kids = db
        .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, pin: students.pin })
        .from(students)
        .where(and(eq(students.familyId, fid), eq(students.status, 'active')))
        .orderBy(students.firstName)
        .all();
      const open = db
        .select({ id: invoices.id, label: invoices.label, dueDate: invoices.dueDate, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.familyId, fid), inArray(invoices.status, ['open', 'partially_paid'])))
        .all()
        .map((i) => ({ id: i.id, label: i.label, dueDate: i.dueDate, balanceCents: invoiceTotal(db, i.id) - invoicePaid(db, i.id) }))
        .filter((i) => i.balanceCents > 0)
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
      const pays = db
        .select({ id: payments.id, amountCents: payments.amountCents, channel: payments.channel, occurredAt: payments.occurredAt, memo: payments.memo, reversalOf: payments.reversalOf })
        .from(payments)
        .where(eq(payments.familyId, fid))
        .orderBy(desc(payments.occurredAt), desc(payments.createdAt))
        .limit(25)
        .all();
      return {
        id: fid,
        name: fam?.name ?? '',
        balance: familyBalance(fid),
        students: kids,
        invoices: open,
        payments: pays,
      };
    });
    return { currency, families: list };
  }),

  /** Published report cards + transcripts for the parent's kids (the documents families keep, §15).
   *  PUBLISHED-only and own-kids-only — the PDFs themselves are served by the authed /reports route,
   *  which re-checks the same wall. For report cards we surface the latest published version per class. */
  myReports: parentProcedure.query(({ ctx }) => {
    const kidIds = parentStudentIds(ctx);
    if (!kidIds.length) return { children: [] as ReportChild[] };

    const kids = db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName }).from(students).where(inArray(students.id, kidIds)).orderBy(students.firstName).all();

    const children: ReportChild[] = kids.map((k) => {
      // Report cards: published only; keep the highest-version published card per class.
      const cards = db
        .select({ id: reportCards.id, classId: reportCards.classId, version: reportCards.version, generatedAt: reportCards.generatedAt, publishedAt: reportCards.publishedAt })
        .from(reportCards)
        .where(and(eq(reportCards.studentId, k.id)))
        .orderBy(desc(reportCards.version))
        .all()
        .filter((c) => c.publishedAt != null);
      const latestPerClass = new Map<string, (typeof cards)[number]>();
      for (const c of cards) if (!latestPerClass.has(c.classId)) latestPerClass.set(c.classId, c); // first = highest version
      const classNames = new Map(db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, [...latestPerClass.keys(), '__none__'])).all().map((r) => [r.id, r.name]));
      const reportCardList = [...latestPerClass.values()].map((c) => ({ id: c.id, className: classNames.get(c.classId) ?? '—', version: c.version, generatedAt: c.generatedAt }));

      // Transcripts: published only; latest published version.
      const trs = db
        .select({ id: transcripts.id, version: transcripts.version, generatedAt: transcripts.generatedAt, publishedAt: transcripts.publishedAt })
        .from(transcripts)
        .where(eq(transcripts.studentId, k.id))
        .orderBy(desc(transcripts.version))
        .all()
        .filter((tr) => tr.publishedAt != null);
      const transcriptList = trs.length ? [{ id: trs[0].id, version: trs[0].version, generatedAt: trs[0].generatedAt }] : [];

      return { studentId: k.id, name: `${k.firstName} ${k.lastName}`.trim(), reportCards: reportCardList, transcripts: transcriptList };
    });
    return { children };
  }),

  /** One of the parent's kids: gradebook items + the kid's score, grouped by class. Read-only. */
  childGrades: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const enrs = db
      .select({ classId: enrollments.classId, className: classes.name })
      .from(enrollments)
      .innerJoin(classes, eq(classes.id, enrollments.classId))
      .where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active')))
      .orderBy(asc(classes.name))
      .all();
    // The kid's scores (points are stored ×100 to avoid float drift).
    const scoreOf = new Map(db.select({ gradeItemId: grades.gradeItemId, points: grades.points }).from(grades).where(eq(grades.studentId, input.studentId)).all().map((g) => [g.gradeItemId, g.points]));
    const classesOut = enrs.map((e) => {
      const items = db
        .select({ id: gradeItems.id, title: gradeItems.title, date: gradeItems.date, maxPoints: gradeItems.maxPoints, category: gradeItems.category })
        .from(gradeItems)
        .where(eq(gradeItems.classId, e.classId))
        .orderBy(asc(gradeItems.createdAt))
        .all();
      return {
        classId: e.classId,
        className: e.className,
        items: items.map((it) => ({ title: it.title, date: it.date, maxPoints: it.maxPoints, category: it.category, points: scoreOf.has(it.id) ? scoreOf.get(it.id)! / 100 : null })),
      };
    });
    return { classes: classesOut };
  }),

  /** One of the parent's kids: attendance tallies + recent records. Read-only. */
  childAttendance: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const rows = db.select({ date: attendance.date, status: attendance.status, classId: attendance.classId }).from(attendance).where(eq(attendance.studentId, input.studentId)).orderBy(desc(attendance.date)).all();
    const counts = { present: 0, absent: 0, late: 0, excused: 0 } as Record<'present' | 'absent' | 'late' | 'excused', number>;
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const classIds = [...new Set(rows.map((r) => r.classId))];
    const classNames = classIds.length ? new Map(db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds)).all().map((c) => [c.id, c.name])) : new Map<string, string>();
    const recent = rows.slice(0, 20).map((r) => ({ date: r.date, status: r.status, className: classNames.get(r.classId) ?? '—' }));
    return { counts, total: rows.length, recent };
  }),

  /** One of the parent's kids: merit total + award history. Read-only. */
  childMerit: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const awards = db.select({ points: meritAwards.points, categoryId: meritAwards.categoryId, note: meritAwards.note, at: meritAwards.createdAt }).from(meritAwards).where(eq(meritAwards.studentId, input.studentId)).orderBy(desc(meritAwards.createdAt)).all();
    const total = awards.reduce((s, a) => s + a.points, 0);
    const catNames = new Map(db.select({ id: meritCategories.id, name: meritCategories.name }).from(meritCategories).all().map((c) => [c.id, c.name]));
    const history = awards.map((a) => ({ points: a.points, category: catNames.get(a.categoryId) ?? '—', note: a.note, at: a.at }));
    return { total, history };
  }),

  /** One of the parent's kids: their weekly timetable (sessions across all enrolled classes). */
  childSchedule: parentProcedure.input(STUDENT).query(({ ctx, input }) => {
    assertStudentAccess(ctx, input.studentId);
    const classIds = db.select({ classId: enrollments.classId }).from(enrollments).where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active'))).all().map((r) => r.classId);
    if (!classIds.length) return { sessions: [] as ScheduleSession[] };
    const sessions = db
      .select({ id: classSessions.id, classId: classSessions.classId, className: classes.name, classType: classes.type, customLabel: classes.customLabel, dayOfWeek: classSessions.dayOfWeek, startMin: classSessions.startMin, endMin: classSessions.endMin, room: classSessions.room })
      .from(classSessions)
      .innerJoin(classes, eq(classes.id, classSessions.classId))
      .where(inArray(classSessions.classId, classIds))
      .orderBy(asc(classSessions.dayOfWeek), asc(classSessions.startMin))
      .all();
    return { sessions };
  }),
});

type ScheduleSession = {
  id: string;
  classId: string;
  className: string;
  classType: 'maktab' | 'hifz' | 'nazrah' | 'alim' | 'custom';
  customLabel: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  room: string | null;
};

type ReportChild = {
  studentId: string;
  name: string;
  reportCards: { id: string; className: string; version: number; generatedAt: Date }[];
  transcripts: { id: string; version: number; generatedAt: Date }[];
};

type FamilyView = {
  id: string;
  name: string;
  balance: ReturnType<typeof familyBalance>;
  students: { id: string; firstName: string; lastName: string; pin: string }[];
  invoices: { id: string; label: string; dueDate: string | null; balanceCents: number }[];
  payments: { id: string; amountCents: number; channel: string; occurredAt: Date; memo: string | null; reversalOf: string | null }[];
};
