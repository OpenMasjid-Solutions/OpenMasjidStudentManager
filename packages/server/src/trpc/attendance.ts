// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Attendance (CLAUDE.md §4/§5/§9): a teacher (or admin) marks a class's roster for a day —
 * present / absent / late / excused, with a bulk "all present" on the client. One row per
 * (student, class, date) — UNIQUE, so a save is an upsert. Same-day marking is normal;
 * **later edits are allowed but audited** (edits to an existing record, or marking a past
 * date) — who last marked is always stored. Teacher access is scoped to their own classes.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { router, adminOrTeacherProcedure, auditActor } from './trpc';
import { assertClassAccess } from './classAccess';
import { db } from '../db';
import { attendance, enrollments, students } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';

const ID = z.string().min(1).max(64);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const STATUS = z.enum(['present', 'absent', 'late', 'excused']);
const now = () => new Date();

/** Server local calendar date (YYYY-MM-DD) — only a fallback for classifying a backfill.
 *  Note: a self-hosted container often runs in UTC while the masjid is elsewhere, so the
 *  caller passes its own `clientToday` (the browser's local day, the same clock that produced
 *  `date`) and we classify against THAT — otherwise a routine evening mark can be mislabelled
 *  a backfill across a UTC midnight. See `mark`. */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const attendanceRouter = router({
  /** The class's active roster for a date, each with its attendance status (null if unmarked). */
  forClassDate: adminOrTeacherProcedure.input(z.object({ classId: ID, date: DATE })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const roster = db
      .select({
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        status: attendance.status,
        note: attendance.note,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .leftJoin(attendance, and(eq(attendance.studentId, students.id), eq(attendance.classId, input.classId), eq(attendance.date, input.date)))
      .where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active')))
      .orderBy(students.firstName)
      .all();
    return { date: input.date, roster };
  }),

  /** Upsert attendance for a set of students on one date. Audits edits + late/backfill marks.
   *  `clientToday` (the browser's local day) classifies backfills consistently with `date`. */
  mark: adminOrTeacherProcedure
    .input(
      z.object({
        classId: ID,
        date: DATE,
        clientToday: DATE.optional(),
        entries: z
          .array(z.object({ studentId: ID, status: STATUS, note: z.string().trim().max(200).optional() }))
          .min(1)
          .max(500)
          .refine((a) => new Set(a.map((e) => e.studentId)).size === a.length, { message: 'Each student may appear only once.' }),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertClassAccess(ctx, input.classId);

      // Only students actively enrolled in this class may be marked (defense in depth).
      const enrolled = new Set(
        db.select({ sid: enrollments.studentId }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active'))).all().map((r) => r.sid),
      );
      for (const e of input.entries) {
        if (!enrolled.has(e.studentId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A student in this list is not enrolled in the class.' });
      }

      const actor = auditActor(ctx);
      const late = input.date < (input.clientToday ?? localToday()); // marking a day before the caller's "today"
      let changed = 0;
      const ts = now();

      db.transaction((tx) => {
        const existing = new Map(
          tx.select().from(attendance).where(and(eq(attendance.classId, input.classId), eq(attendance.date, input.date), inArray(attendance.studentId, input.entries.map((e) => e.studentId)))).all().map((r) => [r.studentId, r]),
        );
        for (const e of input.entries) {
          const prev = existing.get(e.studentId);
          const note = e.note || null;
          if (prev) {
            if (prev.status !== e.status || (prev.note ?? null) !== note) changed++;
            tx.update(attendance).set({ status: e.status, note, markedByUserId: actor.userId, markedByName: actor.name, updatedAt: ts }).where(eq(attendance.id, prev.id)).run();
          } else {
            tx.insert(attendance).values({ id: rid('att'), classId: input.classId, studentId: e.studentId, date: input.date, status: e.status, note, markedByUserId: actor.userId, markedByName: actor.name, createdAt: ts, updatedAt: ts }).run();
          }
        }
      });

      // Audit only what CLAUDE.md §4 requires: later edits + backfills. A fresh same-day mark
      // (all new rows, current date) is routine and not audited. No PII — counts + date only.
      if (late) audit(actor, 'attendance.lateMark', { entity: 'class', entityId: input.classId, detail: { date: input.date, count: input.entries.length, changed } });
      else if (changed > 0) audit(actor, 'attendance.edit', { entity: 'class', entityId: input.classId, detail: { date: input.date, changed } });

      return { ok: true as const, changed, late };
    }),
});
