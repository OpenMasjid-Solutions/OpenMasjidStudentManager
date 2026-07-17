// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Weekly timetable (CLAUDE.md §4/§5): recurring class sessions (day + start/end minutes +
 * room), and read views BY CLASS, BY TEACHER and BY STUDENT. Editing is admin-only; a
 * teacher reads only their OWN week (`mySchedule`) — scoped in the query, never the UI.
 *
 * v1 is MANUAL — no auto-scheduler. Double-bookings raise SOFT warnings (a shared teacher
 * or a shared room at an overlapping time, within the same term + weekday) that the UI
 * surfaces but never block: a madrasa reality is one ustādh genuinely covering two rooms.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { router, adminProcedure, teacherProcedure, auditActor } from './trpc';
import { db } from '../db';
import { classSessions, classes, classTeachers, enrollments, users } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';

const ID = z.string().min(1).max(64);
const DAY = z.number().int().min(0).max(6); // 0=Sun … 6=Sat
const MIN = z.number().int().min(0).max(1439); // minutes from midnight
const ROOM = z.string().trim().max(60).optional();
const now = () => new Date();

/** Two half-open [start,end) minute ranges overlap. */
const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

/** A soft double-booking warning — never blocks a save (§4). The UI composes the sentence. */
export interface SessionWarning {
  kind: 'teacher' | 'room';
  otherClass: string;
  /** shared teacher name(s), for kind='teacher' */
  teacher?: string;
  /** the shared room label, for kind='room' */
  room?: string;
}

function teacherIdsOf(classId: string): Set<string> {
  return new Set(db.select({ userId: classTeachers.userId }).from(classTeachers).where(eq(classTeachers.classId, classId)).all().map((r) => r.userId));
}
function userLabel(id: string): string {
  const u = db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, id)).get();
  return u?.displayName ?? u?.username ?? id;
}

/** Warnings for a candidate session against every other session on the same weekday in the
 *  same term. A shared teacher → teacher clash; a shared non-empty room → room clash. */
function detectConflicts(c: { classId: string; dayOfWeek: number; startMin: number; endMin: number; room?: string | null; excludeId?: string }): SessionWarning[] {
  const cls = db.select({ termId: classes.termId }).from(classes).where(eq(classes.id, c.classId)).get();
  if (!cls) return [];
  const rows = db
    .select({ sid: classSessions.id, classId: classSessions.classId, startMin: classSessions.startMin, endMin: classSessions.endMin, room: classSessions.room, className: classes.name })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(and(eq(classSessions.dayOfWeek, c.dayOfWeek), eq(classes.termId, cls.termId)))
    .all();
  const myTeachers = teacherIdsOf(c.classId);
  const cr = (c.room ?? '').trim().toLowerCase();
  const out: SessionWarning[] = [];
  for (const r of rows) {
    if (r.sid === c.excludeId) continue;
    if (!overlaps(c.startMin, c.endMin, r.startMin, r.endMin)) continue;
    const rr = (r.room ?? '').trim().toLowerCase();
    if (cr && cr === rr) out.push({ kind: 'room', otherClass: r.className, room: r.room ?? '' });
    const shared = [...myTeachers].filter((x) => teacherIdsOf(r.classId).has(x));
    if (shared.length) out.push({ kind: 'teacher', otherClass: r.className, teacher: shared.map(userLabel).join(', ') });
  }
  return out;
}

/** Ordered display rows (day, then start) for a set of classes. */
function sessionRows(classIds: string[]) {
  if (classIds.length === 0) return [];
  return db
    .select({
      id: classSessions.id,
      classId: classSessions.classId,
      className: classes.name,
      classType: classes.type,
      customLabel: classes.customLabel,
      dayOfWeek: classSessions.dayOfWeek,
      startMin: classSessions.startMin,
      endMin: classSessions.endMin,
      room: classSessions.room,
    })
    .from(classSessions)
    .innerJoin(classes, eq(classes.id, classSessions.classId))
    .where(inArray(classSessions.classId, classIds))
    .orderBy(asc(classSessions.dayOfWeek), asc(classSessions.startMin))
    .all();
}

function classIdsForTeacher(userId: string, termId?: string): string[] {
  return db
    .select({ id: classes.id })
    .from(classes)
    .innerJoin(classTeachers, eq(classTeachers.classId, classes.id))
    .where(and(eq(classTeachers.userId, userId), termId ? eq(classes.termId, termId) : undefined))
    .all()
    .map((r) => r.id);
}
function classIdsForStudent(studentId: string, termId?: string): string[] {
  return db
    .select({ id: classes.id })
    .from(classes)
    .innerJoin(enrollments, eq(enrollments.classId, classes.id))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), termId ? eq(classes.termId, termId) : undefined))
    .all()
    .map((r) => r.id);
}

export const scheduleRouter = router({
  // ── Admin: per-class session editing (with soft conflict warnings) ───────────
  /** Sessions of one class, each annotated with any current double-booking warnings. */
  byClass: adminProcedure.input(z.object({ classId: ID })).query(({ input }) => {
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const sessions = sessionRows([input.classId]).map((s) => ({ ...s, warnings: detectConflicts({ classId: s.classId, dayOfWeek: s.dayOfWeek, startMin: s.startMin, endMin: s.endMin, room: s.room, excludeId: s.id }) }));
    return { sessions };
  }),

  createSession: adminProcedure.input(z.object({ classId: ID, dayOfWeek: DAY, startMin: MIN, endMin: MIN, room: ROOM })).mutation(({ ctx, input }) => {
    if (input.endMin <= input.startMin) throw new TRPCError({ code: 'BAD_REQUEST', message: 'End time must be after start time.' });
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const id = rid('ses');
    const ts = now();
    db.insert(classSessions).values({ id, classId: input.classId, dayOfWeek: input.dayOfWeek, startMin: input.startMin, endMin: input.endMin, room: input.room || null, createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'session.create', { entity: 'class', entityId: input.classId, detail: { dayOfWeek: input.dayOfWeek } });
    return { id, warnings: detectConflicts({ ...input, excludeId: id }) };
  }),

  updateSession: adminProcedure.input(z.object({ id: ID, dayOfWeek: DAY, startMin: MIN, endMin: MIN, room: ROOM })).mutation(({ ctx, input }) => {
    if (input.endMin <= input.startMin) throw new TRPCError({ code: 'BAD_REQUEST', message: 'End time must be after start time.' });
    const s = db.select().from(classSessions).where(eq(classSessions.id, input.id)).get();
    if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' });
    db.update(classSessions).set({ dayOfWeek: input.dayOfWeek, startMin: input.startMin, endMin: input.endMin, room: input.room || null, updatedAt: now() }).where(eq(classSessions.id, input.id)).run();
    audit(auditActor(ctx), 'session.update', { entity: 'class', entityId: s.classId, detail: { sessionId: input.id } });
    return { warnings: detectConflicts({ classId: s.classId, dayOfWeek: input.dayOfWeek, startMin: input.startMin, endMin: input.endMin, room: input.room, excludeId: input.id }) };
  }),

  deleteSession: adminProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const s = db.select().from(classSessions).where(eq(classSessions.id, input.id)).get();
    if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' });
    db.delete(classSessions).where(eq(classSessions.id, input.id)).run();
    audit(auditActor(ctx), 'session.delete', { entity: 'class', entityId: s.classId, detail: { sessionId: input.id } });
    return { ok: true as const };
  }),

  // ── Admin timetable views ────────────────────────────────────────────────────
  byTeacher: adminProcedure.input(z.object({ userId: ID, termId: ID.optional() })).query(({ input }) => sessionRows(classIdsForTeacher(input.userId, input.termId))),
  byStudent: adminProcedure.input(z.object({ studentId: ID, termId: ID.optional() })).query(({ input }) => sessionRows(classIdsForStudent(input.studentId, input.termId))),

  // ── Teacher: my own week (scoped to the caller) ──────────────────────────────
  mySchedule: teacherProcedure.input(z.object({ termId: ID.optional() }).optional()).query(({ ctx, input }) => {
    const uid = ctx.session.userId;
    if (!uid) return [];
    return sessionRows(classIdsForTeacher(uid, input?.termId));
  }),
});
