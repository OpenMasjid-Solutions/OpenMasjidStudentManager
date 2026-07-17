// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Gradebook (CLAUDE.md §4/§5/§9): admin-defined grading scales, a per-class scale, gradebook
 * assignments (grade items) and student scores. A teacher works only on their own classes
 * (via `classAccess`); scale definitions are admin-only. Scores are stored as integer
 * hundredths of a point (no float drift); percentages are total-points based. Sensitive
 * writes are audited with no per-student PII in the detail.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, asc } from 'drizzle-orm';
import { router, adminProcedure, adminOrTeacherProcedure, auditActor } from './trpc';
import { assertClassAccess } from './classAccess';
import { db } from '../db';
import { gradingScales, scaleBands, classGradeConfig, gradeItems, grades, enrollments, students, classes } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { seedGradingDefaults, bandFor } from '../grades/scales';

const ID = z.string().min(1).max(64);
const NAME = z.string().trim().min(1).max(120);
const BANDS = z.array(z.object({ label: z.string().trim().min(1).max(60), minPercent: z.number().int().min(0).max(100) })).max(20);
const now = () => new Date();
const round1 = (n: number) => Math.round(n * 10) / 10;

export const gradesRouter = router({
  // ── Grading scales (admin) ───────────────────────────────────────────────────
  scaleList: adminProcedure.query(() => {
    seedGradingDefaults(); // lazily ensure the three shipped defaults exist
    const scales = db.select().from(gradingScales).orderBy(asc(gradingScales.createdAt)).all().filter((s) => !s.archivedAt);
    return scales.map((s) => ({ ...s, bands: db.select({ id: scaleBands.id, label: scaleBands.label, minPercent: scaleBands.minPercent }).from(scaleBands).where(eq(scaleBands.scaleId, s.id)).orderBy(asc(scaleBands.position)).all() }));
  }),

  scaleCreate: adminProcedure.input(z.object({ name: NAME, bands: BANDS.optional() })).mutation(({ ctx, input }) => {
    const id = rid('scl');
    const ts = now();
    db.transaction((tx) => {
      tx.insert(gradingScales).values({ id, name: input.name, isSystem: false, createdAt: ts, updatedAt: ts }).run();
      (input.bands ?? []).forEach((b, i) => tx.insert(scaleBands).values({ id: rid('bnd'), scaleId: id, label: b.label, minPercent: b.minPercent, position: i, createdAt: ts }).run());
    });
    audit(auditActor(ctx), 'scale.create', { entity: 'scale', entityId: id, detail: { name: input.name } });
    return { id };
  }),

  scaleRename: adminProcedure.input(z.object({ id: ID, name: NAME })).mutation(({ ctx, input }) => {
    if (!db.select({ id: gradingScales.id }).from(gradingScales).where(eq(gradingScales.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scale not found.' });
    db.update(gradingScales).set({ name: input.name, updatedAt: now() }).where(eq(gradingScales.id, input.id)).run();
    audit(auditActor(ctx), 'scale.rename', { entity: 'scale', entityId: input.id });
    return { ok: true as const };
  }),

  /** Replace a scale's bands. */
  setBands: adminProcedure.input(z.object({ scaleId: ID, bands: BANDS })).mutation(({ ctx, input }) => {
    if (!db.select({ id: gradingScales.id }).from(gradingScales).where(eq(gradingScales.id, input.scaleId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scale not found.' });
    const ts = now();
    db.transaction((tx) => {
      tx.delete(scaleBands).where(eq(scaleBands.scaleId, input.scaleId)).run();
      input.bands.forEach((b, i) => tx.insert(scaleBands).values({ id: rid('bnd'), scaleId: input.scaleId, label: b.label, minPercent: b.minPercent, position: i, createdAt: ts }).run());
      tx.update(gradingScales).set({ updatedAt: ts }).where(eq(gradingScales.id, input.scaleId)).run();
    });
    audit(auditActor(ctx), 'scale.setBands', { entity: 'scale', entityId: input.scaleId, detail: { count: input.bands.length } });
    return { ok: true as const };
  }),

  scaleArchive: adminProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: gradingScales.id }).from(gradingScales).where(eq(gradingScales.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scale not found.' });
    db.update(gradingScales).set({ archivedAt: now(), updatedAt: now() }).where(eq(gradingScales.id, input.id)).run();
    audit(auditActor(ctx), 'scale.archive', { entity: 'scale', entityId: input.id });
    return { ok: true as const };
  }),

  // ── Per-class scale (admin sets; teacher/admin read) ─────────────────────────
  getConfig: adminOrTeacherProcedure.input(z.object({ classId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const cfg = db.select().from(classGradeConfig).where(eq(classGradeConfig.classId, input.classId)).get();
    const scaleId = cfg?.scaleId ?? null;
    const scale = scaleId ? db.select().from(gradingScales).where(eq(gradingScales.id, scaleId)).get() ?? null : null;
    const bands = scaleId ? db.select({ label: scaleBands.label, minPercent: scaleBands.minPercent }).from(scaleBands).where(eq(scaleBands.scaleId, scaleId)).orderBy(asc(scaleBands.position)).all() : [];
    return { scaleId, scale, bands };
  }),

  setClassScale: adminProcedure.input(z.object({ classId: ID, scaleId: ID.nullable() })).mutation(({ ctx, input }) => {
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (input.scaleId && !db.select({ id: gradingScales.id }).from(gradingScales).where(eq(gradingScales.id, input.scaleId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scale not found.' });
    const ts = now();
    const existing = db.select({ classId: classGradeConfig.classId }).from(classGradeConfig).where(eq(classGradeConfig.classId, input.classId)).get();
    if (existing) db.update(classGradeConfig).set({ scaleId: input.scaleId, updatedAt: ts }).where(eq(classGradeConfig.classId, input.classId)).run();
    else db.insert(classGradeConfig).values({ classId: input.classId, scaleId: input.scaleId, createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'class.setScale', { entity: 'class', entityId: input.classId, detail: { scaleId: input.scaleId } });
    return { ok: true as const };
  }),

  // ── Grade items (adminOrTeacher, own class) ──────────────────────────────────
  itemCreate: adminOrTeacherProcedure.input(z.object({ classId: ID, title: NAME, date: z.string().max(20).optional(), maxPoints: z.number().int().min(1).max(100000), category: z.string().trim().max(60).optional() })).mutation(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const id = rid('gi');
    const ts = now();
    db.insert(gradeItems).values({ id, classId: input.classId, title: input.title, date: input.date || null, maxPoints: input.maxPoints, category: input.category || null, createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'gradeItem.create', { entity: 'class', entityId: input.classId, detail: { title: input.title, maxPoints: input.maxPoints } });
    return { id };
  }),

  itemUpdate: adminOrTeacherProcedure.input(z.object({ id: ID, title: NAME.optional(), date: z.string().max(20).optional(), maxPoints: z.number().int().min(1).max(100000).optional(), category: z.string().trim().max(60).optional() })).mutation(({ ctx, input }) => {
    const item = db.select().from(gradeItems).where(eq(gradeItems.id, input.id)).get();
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
    assertClassAccess(ctx, item.classId);
    // Lowering the max below an already-entered score would push a student over 100% and skew
    // the band — reject it (the same invariant setScores enforces at entry time).
    if (input.maxPoints !== undefined && input.maxPoints < item.maxPoints) {
      const cap = input.maxPoints * 100;
      const tooHigh = db.select({ points: grades.points }).from(grades).where(eq(grades.gradeItemId, input.id)).all().some((g) => g.points > cap);
      if (tooHigh) throw new TRPCError({ code: 'BAD_REQUEST', message: `Some students already have a score above ${input.maxPoints}. Lower those scores before reducing the maximum.` });
    }
    const patch: Partial<typeof gradeItems.$inferInsert> = { updatedAt: now() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.date !== undefined) patch.date = input.date || null;
    if (input.maxPoints !== undefined) patch.maxPoints = input.maxPoints;
    if (input.category !== undefined) patch.category = input.category || null;
    db.update(gradeItems).set(patch).where(eq(gradeItems.id, input.id)).run();
    audit(auditActor(ctx), 'gradeItem.update', { entity: 'class', entityId: item.classId, detail: { itemId: input.id } });
    return { ok: true as const };
  }),

  itemDelete: adminOrTeacherProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const item = db.select().from(gradeItems).where(eq(gradeItems.id, input.id)).get();
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
    assertClassAccess(ctx, item.classId);
    db.delete(gradeItems).where(eq(gradeItems.id, input.id)).run(); // scores cascade
    audit(auditActor(ctx), 'gradeItem.delete', { entity: 'class', entityId: item.classId, detail: { itemId: input.id } });
    return { ok: true as const };
  }),

  // ── The gradebook grid + score entry ─────────────────────────────────────────
  grid: adminOrTeacherProcedure.input(z.object({ classId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const items = db.select().from(gradeItems).where(eq(gradeItems.classId, input.classId)).orderBy(asc(gradeItems.date), asc(gradeItems.createdAt)).all();
    const roster = db
      .select({ studentId: students.id, firstName: students.firstName, lastName: students.lastName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active')))
      .orderBy(asc(students.firstName))
      .all();

    const itemIds = items.map((i) => i.id);
    const allGrades = itemIds.length ? db.select().from(grades).where(inArray(grades.gradeItemId, itemIds)).all() : [];
    // score map: `${itemId}|${studentId}` -> points (×100)
    const scoreOf = new Map<string, number>();
    for (const g of allGrades) scoreOf.set(`${g.gradeItemId}|${g.studentId}`, g.points);

    const maxById = new Map(items.map((i) => [i.id, i.maxPoints]));

    // Per-class scale for banding.
    const cfg = db.select().from(classGradeConfig).where(eq(classGradeConfig.classId, input.classId)).get();
    const scaleId = cfg?.scaleId ?? null;
    const bands = scaleId ? db.select({ label: scaleBands.label, minPercent: scaleBands.minPercent }).from(scaleBands).where(eq(scaleBands.scaleId, scaleId)).orderBy(asc(scaleBands.position)).all() : [];
    const scale = scaleId ? db.select({ id: gradingScales.id, name: gradingScales.name }).from(gradingScales).where(eq(gradingScales.id, scaleId)).get() ?? null : null;

    const studentRows = roster.map((r) => {
      const scores: Record<string, number> = {}; // decimal score per item
      let total = 0; // Σ points (×100)
      let max = 0; // Σ maxPoints for graded items
      for (const it of items) {
        const p = scoreOf.get(`${it.id}|${r.studentId}`);
        if (p === undefined) continue;
        scores[it.id] = p / 100;
        total += p;
        max += it.maxPoints;
      }
      const percent = max > 0 ? round1(total / max) : null; // total/max == Σscore/Σmax*100
      const band = percent !== null ? bandFor(bands, percent) : null;
      return { ...r, scores, percent, band };
    });

    const itemRows = items.map((it) => {
      const scored = roster.map((r) => scoreOf.get(`${it.id}|${r.studentId}`)).filter((v): v is number => v !== undefined);
      const avgPercent = scored.length ? round1(scored.reduce((a, b) => a + b, 0) / scored.length / (maxById.get(it.id) as number)) : null;
      return { id: it.id, title: it.title, date: it.date, maxPoints: it.maxPoints, category: it.category, gradedCount: scored.length, avgPercent };
    });

    return { items: itemRows, students: studentRows, scale, bands };
  }),

  /** Upsert (or clear) scores for one grade item. `points` is a decimal score; null clears it. */
  setScores: adminOrTeacherProcedure
    .input(z.object({ classId: ID, gradeItemId: ID, entries: z.array(z.object({ studentId: ID, points: z.number().min(0).max(100000).nullable() })).min(1).max(500).refine((a) => new Set(a.map((e) => e.studentId)).size === a.length, { message: 'Each student may appear only once.' }) }))
    .mutation(({ ctx, input }) => {
      assertClassAccess(ctx, input.classId);
      const item = db.select().from(gradeItems).where(eq(gradeItems.id, input.gradeItemId)).get();
      if (!item || item.classId !== input.classId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found in this class.' });
      const enrolled = new Set(db.select({ sid: enrollments.studentId }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active'))).all().map((r) => r.sid));
      for (const e of input.entries) {
        if (!enrolled.has(e.studentId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A student in this list is not enrolled in the class.' });
        if (e.points !== null && e.points > item.maxPoints) throw new TRPCError({ code: 'BAD_REQUEST', message: `A score exceeds the maximum of ${item.maxPoints}.` });
      }
      const actor = auditActor(ctx);
      const ts = now();
      let changed = 0;
      db.transaction((tx) => {
        const existing = new Map(tx.select().from(grades).where(and(eq(grades.gradeItemId, input.gradeItemId), inArray(grades.studentId, input.entries.map((e) => e.studentId)))).all().map((g) => [g.studentId, g]));
        for (const e of input.entries) {
          const prev = existing.get(e.studentId);
          if (e.points === null) {
            if (prev) { tx.delete(grades).where(eq(grades.id, prev.id)).run(); changed++; }
            continue;
          }
          const points = Math.round(e.points * 100);
          if (prev) {
            if (prev.points !== points) changed++;
            tx.update(grades).set({ points, markedByUserId: actor.userId, markedByName: actor.name, updatedAt: ts }).where(eq(grades.id, prev.id)).run();
          } else {
            tx.insert(grades).values({ id: rid('grd'), gradeItemId: input.gradeItemId, studentId: e.studentId, points, markedByUserId: actor.userId, markedByName: actor.name, createdAt: ts, updatedAt: ts }).run();
            changed++;
          }
        }
      });
      // Grades are a sensitive write (§14) — audit every save; no per-student PII in the detail.
      audit(actor, 'grades.set', { entity: 'class', entityId: input.classId, detail: { gradeItemId: input.gradeItemId, changed } });
      return { ok: true as const, changed };
    }),
});
