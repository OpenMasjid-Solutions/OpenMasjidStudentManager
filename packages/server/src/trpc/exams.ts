// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Exams (CLAUDE.md §4/§5/§9): the admin defines a term's exams and assigns each to classes.
 * Assigning SNAPSHOTS the class's subjects (with editable per-subject max marks) so later
 * subject edits never corrupt a past exam. Teachers (and admin) fill a students × subjects
 * grid — a mark, or an explicit `absent` / `exempt` (a blank = not entered, which blocks
 * completion) — plus an optional per-student term remark. Admin sees a completion dashboard.
 *
 * Definitions/assignment are admin-only; score entry is admin or the assigned teacher (scoped
 * via classAccess). Score writes are audited without per-student PII.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, asc } from 'drizzle-orm';
import { router, adminProcedure, adminOrTeacherProcedure, auditActor } from './trpc';
import { assertClassAccess } from './classAccess';
import { db } from '../db';
import { exams, examClasses, examClassSubjects, examScores, termRemarks, classSubjects, enrollments, students, classes, terms } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';

const ID = z.string().min(1).max(64);
const NAME = z.string().trim().min(1).max(120);
const now = () => new Date();

function resolveExamClass(examId: string, classId: string) {
  const ec = db.select().from(examClasses).where(and(eq(examClasses.examId, examId), eq(examClasses.classId, classId))).get();
  if (!ec) throw new TRPCError({ code: 'NOT_FOUND', message: 'This exam is not assigned to this class.' });
  return ec;
}

/** A closed term's marks are frozen into term_finals; reject edits until it's reopened (§4). */
function assertTermOpen(classId: string) {
  const term = db.select({ closedAt: terms.closedAt }).from(classes).innerJoin(terms, eq(terms.id, classes.termId)).where(eq(classes.id, classId)).get();
  if (term?.closedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This term is closed. Ask the office to reopen it before changing marks.' });
}

export const examsRouter = router({
  // ── Admin: exam definitions ────────────────────────────────────────────────
  examList: adminProcedure.input(z.object({ termId: ID })).query(({ input }) =>
    db.select().from(exams).where(and(eq(exams.termId, input.termId), eq(exams.status, 'active'))).orderBy(asc(exams.position), asc(exams.createdAt)).all(),
  ),

  examCreate: adminProcedure.input(z.object({ termId: ID, name: NAME })).mutation(({ ctx, input }) => {
    if (!db.select({ id: terms.id }).from(terms).where(eq(terms.id, input.termId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Term not found.' });
    const id = rid('exm');
    const ts = now();
    const maxPos = db.select({ p: exams.position }).from(exams).where(eq(exams.termId, input.termId)).all().reduce((m, r) => Math.max(m, r.p), -1);
    db.insert(exams).values({ id, termId: input.termId, name: input.name, position: maxPos + 1, status: 'active', createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'exam.create', { entity: 'exam', entityId: id, detail: { name: input.name } });
    return { id };
  }),

  examRename: adminProcedure.input(z.object({ id: ID, name: NAME })).mutation(({ ctx, input }) => {
    if (!db.select({ id: exams.id }).from(exams).where(eq(exams.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Exam not found.' });
    db.update(exams).set({ name: input.name, updatedAt: now() }).where(eq(exams.id, input.id)).run();
    audit(auditActor(ctx), 'exam.rename', { entity: 'exam', entityId: input.id });
    return { ok: true as const };
  }),

  examArchive: adminProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: exams.id }).from(exams).where(eq(exams.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Exam not found.' });
    db.update(exams).set({ status: 'archived', updatedAt: now() }).where(eq(exams.id, input.id)).run();
    audit(auditActor(ctx), 'exam.archive', { entity: 'exam', entityId: input.id });
    return { ok: true as const };
  }),

  /** Assign an exam to a class — snapshots the class's current subjects into the exam. */
  assignClass: adminProcedure.input(z.object({ examId: ID, classId: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: exams.id }).from(exams).where(eq(exams.id, input.examId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Exam not found.' });
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (db.select({ id: examClasses.id }).from(examClasses).where(and(eq(examClasses.examId, input.examId), eq(examClasses.classId, input.classId))).get()) return { ok: true as const };
    const subjects = db.select().from(classSubjects).where(eq(classSubjects.classId, input.classId)).orderBy(asc(classSubjects.position)).all();
    const ts = now();
    const ecId = rid('exc');
    db.transaction((tx) => {
      tx.insert(examClasses).values({ id: ecId, examId: input.examId, classId: input.classId, createdAt: ts }).run();
      subjects.forEach((s, i) => tx.insert(examClassSubjects).values({ id: rid('ecs'), examClassId: ecId, name: s.name, maxMarks: 100, position: i, createdAt: ts }).run());
    });
    audit(auditActor(ctx), 'exam.assignClass', { entity: 'exam', entityId: input.examId, detail: { classId: input.classId, subjects: subjects.length } });
    return { ok: true as const };
  }),

  /** Unassign — removes the exam-class and its snapshot subjects + entered scores (audited). */
  unassignClass: adminProcedure.input(z.object({ examId: ID, classId: ID })).mutation(({ ctx, input }) => {
    const ec = db.select({ id: examClasses.id }).from(examClasses).where(and(eq(examClasses.examId, input.examId), eq(examClasses.classId, input.classId))).get();
    if (!ec) return { ok: true as const };
    db.delete(examClasses).where(eq(examClasses.id, ec.id)).run(); // cascade subjects + scores
    audit(auditActor(ctx), 'exam.unassignClass', { entity: 'exam', entityId: input.examId, detail: { classId: input.classId } });
    return { ok: true as const };
  }),

  setSubjectMax: adminProcedure.input(z.object({ subjectId: ID, maxMarks: z.number().int().min(1).max(100000) })).mutation(({ ctx, input }) => {
    const subj = db.select().from(examClassSubjects).where(eq(examClassSubjects.id, input.subjectId)).get();
    if (!subj) throw new TRPCError({ code: 'NOT_FOUND', message: 'Subject not found.' });
    // Don't allow a max below an already-entered mark (would make a score exceed its own max).
    const over = db.select({ value: examScores.value }).from(examScores).where(and(eq(examScores.subjectId, input.subjectId), eq(examScores.status, 'scored'))).all().some((s) => (s.value ?? 0) > input.maxMarks);
    if (over) throw new TRPCError({ code: 'BAD_REQUEST', message: `A student already has a mark above ${input.maxMarks}. Lower those marks first.` });
    db.update(examClassSubjects).set({ maxMarks: input.maxMarks }).where(eq(examClassSubjects.id, input.subjectId)).run();
    audit(auditActor(ctx), 'exam.setSubjectMax', { entity: 'examSubject', entityId: input.subjectId, detail: { maxMarks: input.maxMarks } });
    return { ok: true as const };
  }),

  /** Per-class completion for an exam: scored-vs-enrolled×subjects across teachers. */
  completion: adminProcedure.input(z.object({ examId: ID })).query(({ input }) => {
    const ecs = db
      .select({ ecId: examClasses.id, classId: examClasses.classId, className: classes.name })
      .from(examClasses)
      .innerJoin(classes, eq(classes.id, examClasses.classId))
      .where(eq(examClasses.examId, input.examId))
      .all();
    return ecs.map((ec) => {
      const enrolled = db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, ec.classId), eq(enrollments.status, 'active'))).all().length;
      const subjectCount = db.select({ id: examClassSubjects.id }).from(examClassSubjects).where(eq(examClassSubjects.examClassId, ec.ecId)).all().length;
      const entered = db.select({ id: examScores.id }).from(examScores).where(eq(examScores.examClassId, ec.ecId)).all().length;
      const total = enrolled * subjectCount;
      return { classId: ec.classId, className: ec.className, enrolled, subjectCount, entered, total, percent: total > 0 ? Math.round((entered / total) * 100) : 0 };
    });
  }),

  // ── Teacher/admin: score entry (scoped) ──────────────────────────────────────
  /** Active exams assigned to a class (for the teacher to pick). */
  classExams: adminOrTeacherProcedure.input(z.object({ classId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    return db
      .select({ examId: exams.id, name: exams.name, examClassId: examClasses.id })
      .from(examClasses)
      .innerJoin(exams, eq(exams.id, examClasses.examId))
      .where(and(eq(examClasses.classId, input.classId), eq(exams.status, 'active')))
      .orderBy(asc(exams.position), asc(exams.createdAt))
      .all();
  }),

  /** The score grid for one exam-class: subjects, roster, scores, term remarks, progress. */
  grid: adminOrTeacherProcedure.input(z.object({ examId: ID, classId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const ec = resolveExamClass(input.examId, input.classId);
    const subjects = db.select({ id: examClassSubjects.id, name: examClassSubjects.name, maxMarks: examClassSubjects.maxMarks }).from(examClassSubjects).where(eq(examClassSubjects.examClassId, ec.id)).orderBy(asc(examClassSubjects.position)).all();
    const roster = db
      .select({ studentId: students.id, firstName: students.firstName, lastName: students.lastName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active')))
      .orderBy(asc(students.firstName))
      .all();
    const scoreRows = db.select().from(examScores).where(eq(examScores.examClassId, ec.id)).all();
    const scores: Record<string, { status: 'scored' | 'absent' | 'exempt'; value: number | null }> = {};
    for (const s of scoreRows) scores[`${s.studentId}|${s.subjectId}`] = { status: s.status, value: s.value };
    const remarkRows = db.select({ studentId: termRemarks.studentId, remark: termRemarks.remark }).from(termRemarks).where(eq(termRemarks.classId, input.classId)).all();
    const remarks: Record<string, string> = {};
    for (const r of remarkRows) remarks[r.studentId] = r.remark;
    const total = roster.length * subjects.length;
    return { examClassId: ec.id, subjects, students: roster, scores, remarks, progress: { entered: scoreRows.length, total } };
  }),

  /** Upsert or clear one cell. `status: 'clear'` deletes the mark (back to blank). */
  setScore: adminOrTeacherProcedure
    .input(z.object({ examId: ID, classId: ID, studentId: ID, subjectId: ID, status: z.enum(['scored', 'absent', 'exempt', 'clear']), value: z.number().int().min(0).max(100000).nullable().optional() }))
    .mutation(({ ctx, input }) => {
      assertClassAccess(ctx, input.classId);
      assertTermOpen(input.classId);
      const ec = resolveExamClass(input.examId, input.classId);
      const subj = db.select().from(examClassSubjects).where(and(eq(examClassSubjects.id, input.subjectId), eq(examClassSubjects.examClassId, ec.id))).get();
      if (!subj) throw new TRPCError({ code: 'NOT_FOUND', message: 'Subject not found for this exam.' });
      if (!db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active'))).get()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That student is not enrolled in this class.' });
      }
      const existing = db.select().from(examScores).where(and(eq(examScores.examClassId, ec.id), eq(examScores.studentId, input.studentId), eq(examScores.subjectId, input.subjectId))).get();
      const actor = auditActor(ctx);
      const ts = now();
      if (input.status === 'clear') {
        if (existing) db.delete(examScores).where(eq(examScores.id, existing.id)).run();
      } else {
        let value: number | null = null;
        if (input.status === 'scored') {
          if (input.value === null || input.value === undefined) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a mark.' });
          if (input.value > subj.maxMarks) throw new TRPCError({ code: 'BAD_REQUEST', message: `The mark is above the maximum of ${subj.maxMarks}.` });
          value = input.value;
        }
        if (existing) db.update(examScores).set({ status: input.status, value, markedByUserId: actor.userId, markedByName: actor.name, updatedAt: ts }).where(eq(examScores.id, existing.id)).run();
        else db.insert(examScores).values({ id: rid('exs'), examClassId: ec.id, studentId: input.studentId, subjectId: input.subjectId, status: input.status, value, markedByUserId: actor.userId, markedByName: actor.name, createdAt: ts, updatedAt: ts }).run();
      }
      audit(actor, 'exam.score', { entity: 'class', entityId: input.classId, detail: { subjectId: input.subjectId, status: input.status } });
      return { ok: true as const };
    }),

  /** Upsert (or clear, when empty) a student's term remark for a class. */
  setRemark: adminOrTeacherProcedure.input(z.object({ classId: ID, studentId: ID, remark: z.string().trim().max(2000) })).mutation(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    assertTermOpen(input.classId);
    const cls = db.select({ termId: classes.termId }).from(classes).where(eq(classes.id, input.classId)).get();
    if (!cls) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (!db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active'))).get()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'That student is not enrolled in this class.' });
    }
    const existing = db.select().from(termRemarks).where(and(eq(termRemarks.classId, input.classId), eq(termRemarks.studentId, input.studentId))).get();
    const actor = auditActor(ctx);
    const ts = now();
    if (!input.remark) {
      if (existing) db.delete(termRemarks).where(eq(termRemarks.id, existing.id)).run();
    } else if (existing) {
      db.update(termRemarks).set({ remark: input.remark, authorUserId: actor.userId, authorName: actor.name, updatedAt: ts }).where(eq(termRemarks.id, existing.id)).run();
    } else {
      db.insert(termRemarks).values({ id: rid('trm'), classId: input.classId, termId: cls.termId, studentId: input.studentId, remark: input.remark, authorUserId: actor.userId, authorName: actor.name, createdAt: ts, updatedAt: ts }).run();
    }
    audit(actor, 'exam.remark', { entity: 'class', entityId: input.classId, detail: { studentId_present: true } });
    return { ok: true as const };
  }),
});
