// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Classes & scheduling (CLAUDE.md §4/§5/§9): terms, classes (type + ordered subjects),
 * teacher assignment, and enrollments. Admin-only in this slice; teacher-facing reads
 * (my classes / rosters) and teacher scoping activate in the next slice. Classes are
 * archived and enrollments withdrawn — never hard-deleted (§9). Audited.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, asc } from 'drizzle-orm';
import { router, adminProcedure, teacherProcedure, auditActor } from './trpc';
import { db } from '../db';
import { terms, classes, classSubjects, classTeachers, enrollments, students, users, classSessions } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';

const ID = z.string().min(1).max(64);
const NAME = z.string().trim().min(1).max(120);
const SHORT = z.string().trim().max(120).optional();
const now = () => new Date();
const CLASS_TYPE = z.enum(['maktab', 'hifz', 'nazrah', 'alim', 'custom']);

export const classesRouter = router({
  // ── Terms ──────────────────────────────────────────────────────────────────
  termList: adminProcedure.query(() => db.select().from(terms).orderBy(asc(terms.createdAt)).all()),

  termCreate: adminProcedure
    .input(z.object({ name: NAME, startDate: z.string().max(20).optional(), endDate: z.string().max(20).optional(), isCurrent: z.boolean().optional() }))
    .mutation(({ ctx, input }) => {
      const id = rid('trm');
      const ts = now();
      db.transaction((tx) => {
        if (input.isCurrent) tx.update(terms).set({ isCurrent: false }).run(); // at most one current term
        tx.insert(terms).values({ id, name: input.name, startDate: input.startDate || null, endDate: input.endDate || null, isCurrent: input.isCurrent ?? false, status: 'active', createdAt: ts, updatedAt: ts }).run();
      });
      audit(auditActor(ctx), 'term.create', { entity: 'term', entityId: id, detail: { name: input.name } });
      return { id };
    }),

  termSetCurrent: adminProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: terms.id }).from(terms).where(eq(terms.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Term not found.' });
    db.transaction((tx) => {
      tx.update(terms).set({ isCurrent: false }).run();
      tx.update(terms).set({ isCurrent: true, updatedAt: now() }).where(eq(terms.id, input.id)).run();
    });
    audit(auditActor(ctx), 'term.setCurrent', { entity: 'term', entityId: input.id });
    return { ok: true as const };
  }),

  // ── Classes ────────────────────────────────────────────────────────────────
  classCreate: adminProcedure
    .input(z.object({ termId: ID, name: NAME, type: CLASS_TYPE, customLabel: SHORT, scheduleLabel: SHORT }))
    .mutation(({ ctx, input }) => {
      if (!db.select({ id: terms.id }).from(terms).where(eq(terms.id, input.termId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Term not found.' });
      const id = rid('cls');
      const ts = now();
      db.insert(classes).values({ id, termId: input.termId, name: input.name, type: input.type, customLabel: input.customLabel || null, scheduleLabel: input.scheduleLabel || null, status: 'active', createdAt: ts, updatedAt: ts }).run();
      audit(auditActor(ctx), 'class.create', { entity: 'class', entityId: id, detail: { name: input.name, type: input.type } });
      return { id };
    }),

  classList: adminProcedure.input(z.object({ termId: ID }).optional()).query(({ input }) =>
    input?.termId
      ? db.select().from(classes).where(eq(classes.termId, input.termId)).orderBy(asc(classes.name)).all()
      : db.select().from(classes).orderBy(asc(classes.name)).all(),
  ),

  classGet: adminProcedure.input(z.object({ id: ID })).query(({ input }) => {
    const cls = db.select().from(classes).where(eq(classes.id, input.id)).get();
    if (!cls) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const subjects = db.select().from(classSubjects).where(eq(classSubjects.classId, cls.id)).orderBy(asc(classSubjects.position)).all();
    const teachers = db
      .select({ userId: classTeachers.userId, username: users.username, displayName: users.displayName })
      .from(classTeachers)
      .innerJoin(users, eq(users.id, classTeachers.userId))
      .where(eq(classTeachers.classId, cls.id))
      .all();
    const roster = db
      .select({ enrollmentId: enrollments.id, studentId: students.id, firstName: students.firstName, lastName: students.lastName, status: enrollments.status })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(eq(enrollments.classId, cls.id))
      .orderBy(asc(students.firstName))
      .all();
    return { class: cls, subjects, teachers, roster };
  }),

  classUpdate: adminProcedure
    .input(z.object({ id: ID, name: SHORT, scheduleLabel: SHORT, customLabel: SHORT, status: z.enum(['active', 'archived']).optional() }))
    .mutation(({ ctx, input }) => {
      if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
      const patch: Partial<typeof classes.$inferInsert> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.scheduleLabel !== undefined) patch.scheduleLabel = input.scheduleLabel || null;
      if (input.customLabel !== undefined) patch.customLabel = input.customLabel || null;
      if (input.status !== undefined) patch.status = input.status;
      db.update(classes).set(patch).where(eq(classes.id, input.id)).run();
      audit(auditActor(ctx), 'class.update', { entity: 'class', entityId: input.id });
      return { ok: true as const };
    }),

  /** Replace a class's ordered subject list. Names must be distinct (case/diacritic-insensitive):
   *  report cards align a subject across a term's exams BY NAME, so duplicates would collide. */
  setSubjects: adminProcedure
    .input(
      z.object({
        classId: ID,
        subjects: z
          .array(z.string().trim().min(1).max(120))
          .max(50)
          .refine((a) => {
            const norm = a.map((s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase());
            return new Set(norm).size === norm.length;
          }, { message: 'Each subject must have a distinct name.' }),
      }),
    )
    .mutation(({ ctx, input }) => {
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const ts = now();
    db.transaction((tx) => {
      tx.delete(classSubjects).where(eq(classSubjects.classId, input.classId)).run();
      input.subjects.forEach((name, i) => tx.insert(classSubjects).values({ id: rid('sub'), classId: input.classId, name, position: i, createdAt: ts }).run());
    });
    audit(auditActor(ctx), 'class.setSubjects', { entity: 'class', entityId: input.classId, detail: { count: input.subjects.length } });
    return { ok: true as const };
  }),

  // ── Teacher-scoped reads (§5: a teacher sees ONLY their own classes) ──────────
  /** Classes the calling teacher is assigned to (optionally within a term). */
  mine: teacherProcedure.input(z.object({ termId: ID }).optional()).query(({ ctx, input }) => {
    const uid = ctx.session.userId;
    if (!uid) return [];
    return db
      .select({ id: classes.id, name: classes.name, type: classes.type, customLabel: classes.customLabel, scheduleLabel: classes.scheduleLabel, status: classes.status, termId: classes.termId })
      .from(classes)
      .innerJoin(classTeachers, eq(classTeachers.classId, classes.id))
      .where(and(eq(classTeachers.userId, uid), input?.termId ? eq(classes.termId, input.termId) : undefined))
      .orderBy(asc(classes.name))
      .all();
  }),

  /** Read-only detail of ONE of the teacher's own classes — subjects, co-teachers, the
   *  active roster and the weekly sessions. 403 if the class isn't assigned to the caller
   *  (the wall is in the query, not the UI). Teachers never see PINs. */
  mineGet: teacherProcedure.input(z.object({ id: ID })).query(({ ctx, input }) => {
    const uid = ctx.session.userId;
    const assigned = uid && db.select({ classId: classTeachers.classId }).from(classTeachers).where(and(eq(classTeachers.classId, input.id), eq(classTeachers.userId, uid))).get();
    if (!assigned) throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only open your own classes.' });
    const cls = db.select().from(classes).where(eq(classes.id, input.id)).get();
    if (!cls) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const subjects = db.select().from(classSubjects).where(eq(classSubjects.classId, cls.id)).orderBy(asc(classSubjects.position)).all();
    const teachers = db
      .select({ userId: classTeachers.userId, username: users.username, displayName: users.displayName })
      .from(classTeachers)
      .innerJoin(users, eq(users.id, classTeachers.userId))
      .where(eq(classTeachers.classId, cls.id))
      .all();
    const roster = db
      .select({ studentId: students.id, firstName: students.firstName, lastName: students.lastName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, cls.id), eq(enrollments.status, 'active')))
      .orderBy(asc(students.firstName))
      .all();
    const sessions = db.select().from(classSessions).where(eq(classSessions.classId, cls.id)).orderBy(asc(classSessions.dayOfWeek), asc(classSessions.startMin)).all();
    return { class: cls, subjects, teachers, roster, sessions };
  }),

  // ── Teacher assignment ─────────────────────────────────────────────────────
  assignTeacher: adminProcedure.input(z.object({ classId: ID, userId: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const u = db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId)).get();
    if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    if (u.role !== 'teacher' && u.role !== 'admin') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only teachers can be assigned to a class.' });
    if (db.select().from(classTeachers).where(and(eq(classTeachers.classId, input.classId), eq(classTeachers.userId, input.userId))).get()) return { ok: true as const };
    db.insert(classTeachers).values({ classId: input.classId, userId: input.userId, createdAt: now() }).run();
    audit(auditActor(ctx), 'class.assignTeacher', { entity: 'class', entityId: input.classId, detail: { userId: input.userId } });
    return { ok: true as const };
  }),

  unassignTeacher: adminProcedure.input(z.object({ classId: ID, userId: ID })).mutation(({ ctx, input }) => {
    db.delete(classTeachers).where(and(eq(classTeachers.classId, input.classId), eq(classTeachers.userId, input.userId))).run();
    audit(auditActor(ctx), 'class.unassignTeacher', { entity: 'class', entityId: input.classId, detail: { userId: input.userId } });
    return { ok: true as const };
  }),

  // ── Enrollments ────────────────────────────────────────────────────────────
  enroll: adminProcedure.input(z.object({ classId: ID, studentId: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (!db.select({ id: students.id }).from(students).where(eq(students.id, input.studentId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Student not found.' });
    const ex = db.select().from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.studentId, input.studentId))).get();
    if (ex) {
      if (ex.status === 'withdrawn') db.update(enrollments).set({ status: 'active', updatedAt: now() }).where(eq(enrollments.id, ex.id)).run();
      return { ok: true as const };
    }
    db.insert(enrollments).values({ id: rid('enr'), classId: input.classId, studentId: input.studentId, status: 'active', createdAt: now(), updatedAt: now() }).run();
    audit(auditActor(ctx), 'enroll', { entity: 'class', entityId: input.classId, detail: { studentId: input.studentId } });
    return { ok: true as const };
  }),

  unenroll: adminProcedure.input(z.object({ enrollmentId: ID })).mutation(({ ctx, input }) => {
    const e = db.select().from(enrollments).where(eq(enrollments.id, input.enrollmentId)).get();
    if (!e) throw new TRPCError({ code: 'NOT_FOUND', message: 'Enrollment not found.' });
    db.update(enrollments).set({ status: 'withdrawn', updatedAt: now() }).where(eq(enrollments.id, input.enrollmentId)).run();
    audit(auditActor(ctx), 'unenroll', { entity: 'class', entityId: e.classId, detail: { studentId: e.studentId } });
    return { ok: true as const };
  }),
});
