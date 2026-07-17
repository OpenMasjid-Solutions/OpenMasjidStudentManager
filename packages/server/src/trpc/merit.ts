// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Merit points (CLAUDE.md §4/§5): admin-defined categories with default point values, and
 * awards (or deductions) to students in a class the caller teaches (admin: any class). A
 * class summary gives per-student term totals + a staff-side leaderboard and the recent
 * awards. Categories are admin-managed; awarding is admin or the assigned teacher (scoped via
 * classAccess). Finance never sees merit; parents see their own kids in the portal (later).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { router, adminProcedure, adminOrTeacherProcedure, auditActor } from './trpc';
import { assertClassAccess } from './classAccess';
import { db } from '../db';
import { meritCategories, meritAwards, enrollments, students, classes } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { seedMeritDefaults } from '../merit/categories';

const ID = z.string().min(1).max(64);
const NAME = z.string().trim().min(1).max(80);
const POINTS = z.number().int().min(-1000).max(1000);
const now = () => new Date();

export const meritRouter = router({
  // ── Categories ───────────────────────────────────────────────────────────────
  /** Categories are read by staff who award (admin + teacher); seeded lazily. */
  categoryList: adminOrTeacherProcedure.query(() => {
    seedMeritDefaults();
    return db.select().from(meritCategories).all().filter((c) => !c.archivedAt).sort((a, b) => a.position - b.position);
  }),

  categoryCreate: adminProcedure.input(z.object({ name: NAME, defaultPoints: POINTS.default(0) })).mutation(({ ctx, input }) => {
    const id = rid('mct');
    const ts = now();
    const maxPos = db.select({ p: meritCategories.position }).from(meritCategories).all().reduce((m, r) => Math.max(m, r.p), -1);
    db.insert(meritCategories).values({ id, name: input.name, defaultPoints: input.defaultPoints, isSystem: false, position: maxPos + 1, createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'meritCategory.create', { entity: 'meritCategory', entityId: id, detail: { name: input.name } });
    return { id };
  }),

  categoryUpdate: adminProcedure.input(z.object({ id: ID, name: NAME.optional(), defaultPoints: POINTS.optional() })).mutation(({ ctx, input }) => {
    if (!db.select({ id: meritCategories.id }).from(meritCategories).where(eq(meritCategories.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found.' });
    const patch: Partial<typeof meritCategories.$inferInsert> = { updatedAt: now() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.defaultPoints !== undefined) patch.defaultPoints = input.defaultPoints;
    db.update(meritCategories).set(patch).where(eq(meritCategories.id, input.id)).run();
    audit(auditActor(ctx), 'meritCategory.update', { entity: 'meritCategory', entityId: input.id });
    return { ok: true as const };
  }),

  categoryArchive: adminProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    if (!db.select({ id: meritCategories.id }).from(meritCategories).where(eq(meritCategories.id, input.id)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found.' });
    db.update(meritCategories).set({ archivedAt: now(), updatedAt: now() }).where(eq(meritCategories.id, input.id)).run();
    audit(auditActor(ctx), 'meritCategory.archive', { entity: 'meritCategory', entityId: input.id });
    return { ok: true as const };
  }),

  // ── Awards (adminOrTeacher, own class) ────────────────────────────────────────
  award: adminOrTeacherProcedure.input(z.object({ classId: ID, studentId: ID, categoryId: ID, points: POINTS, note: z.string().trim().max(200).optional() })).mutation(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const cls = db.select({ termId: classes.termId }).from(classes).where(eq(classes.id, input.classId)).get();
    if (!cls) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    const enrolled = db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active'))).get();
    if (!enrolled) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That student is not enrolled in this class.' });
    if (!db.select({ id: meritCategories.id }).from(meritCategories).where(eq(meritCategories.id, input.categoryId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found.' });
    const id = rid('maw');
    const ts = now();
    const actor = auditActor(ctx);
    db.insert(meritAwards).values({ id, studentId: input.studentId, classId: input.classId, termId: cls.termId, categoryId: input.categoryId, points: input.points, note: input.note || null, awardedByUserId: actor.userId, awardedByName: actor.name, createdAt: ts, updatedAt: ts }).run();
    audit(actor, 'merit.award', { entity: 'class', entityId: input.classId, detail: { categoryId: input.categoryId, points: input.points } });
    return { id };
  }),

  /** Remove an award (a fat-finger undo) — scoped to the caller's class, audited. */
  awardDelete: adminOrTeacherProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const aw = db.select().from(meritAwards).where(eq(meritAwards.id, input.id)).get();
    if (!aw) throw new TRPCError({ code: 'NOT_FOUND', message: 'Award not found.' });
    assertClassAccess(ctx, aw.classId);
    db.delete(meritAwards).where(eq(meritAwards.id, input.id)).run();
    audit(auditActor(ctx), 'merit.awardDelete', { entity: 'class', entityId: aw.classId, detail: { awardId: input.id, points: aw.points } });
    return { ok: true as const };
  }),

  /** Per-class merit: roster with term totals (a staff-side leaderboard) + recent awards. */
  classSummary: adminOrTeacherProcedure.input(z.object({ classId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const roster = db
      .select({ studentId: students.id, firstName: students.firstName, lastName: students.lastName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active')))
      .all();

    // Sum points per student for this class (a class belongs to one term, so this is the term total here).
    const awards = db.select().from(meritAwards).where(eq(meritAwards.classId, input.classId)).all();
    const totalBy = new Map<string, number>();
    for (const a of awards) totalBy.set(a.studentId, (totalBy.get(a.studentId) ?? 0) + a.points);

    const catName = new Map(db.select({ id: meritCategories.id, name: meritCategories.name }).from(meritCategories).all().map((c) => [c.id, c.name]));
    const nameBy = new Map(roster.map((r) => [r.studentId, `${r.firstName} ${r.lastName}`]));

    const students_ = roster
      .map((r) => ({ ...r, total: totalBy.get(r.studentId) ?? 0 }))
      .sort((a, b) => b.total - a.total || a.firstName.localeCompare(b.firstName));

    const recent = [...awards]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20)
      .map((a) => ({ id: a.id, studentId: a.studentId, studentName: nameBy.get(a.studentId) ?? '—', categoryName: catName.get(a.categoryId) ?? '—', points: a.points, note: a.note, by: a.awardedByName, at: a.createdAt }));

    return { students: students_, recent };
  }),
});
