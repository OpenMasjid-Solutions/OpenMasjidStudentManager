// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report cards (CLAUDE.md §4/§5/§9): admin generates/regenerates (version N+1) and publishes;
 * admin and the assigned teacher can read the versions list. The PDFs themselves are streamed
 * only through the authed `/reports/*` routes (reports/routes.ts), never a guessable URL. Parent
 * reads (own kids, published only) arrive with the portal.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, asc, desc } from 'drizzle-orm';
import { router, adminProcedure, adminOrTeacherProcedure, auditActor } from './trpc';
import { assertClassAccess } from './classAccess';
import { db } from '../db';
import { reportCards, enrollments, students, classes, transcripts } from '../db/schema';
import { audit } from '../audit';
import { generateStudentCard, generateClassCards } from '../reports/generate';
import { generateTranscript } from '../reports/transcript';

const ID = z.string().min(1).max(64);
const now = () => new Date();

export const reportsRouter = router({
  // ── Generate (admin only) ────────────────────────────────────────────────────
  generateStudent: adminProcedure.input(z.object({ classId: ID, studentId: ID })).mutation(async ({ ctx, input }) => {
    if (!db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.studentId, input.studentId), eq(enrollments.status, 'active'))).get()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That student isn’t enrolled in this class.' });
    }
    return generateStudentCard(input.studentId, input.classId, auditActor(ctx));
  }),

  generateClass: adminProcedure.input(z.object({ classId: ID })).mutation(async ({ ctx, input }) => {
    if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
    return generateClassCards(input.classId, auditActor(ctx));
  }),

  // ── Read (admin or the assigned teacher) ─────────────────────────────────────
  /** Per active student: their latest report card (or none) + how many versions exist. */
  list: adminOrTeacherProcedure.input(z.object({ classId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    const roster = db
      .select({ studentId: students.id, firstName: students.firstName, lastName: students.lastName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active')))
      .orderBy(asc(students.firstName))
      .all();
    return roster.map((r) => {
      const cards = db.select().from(reportCards).where(and(eq(reportCards.studentId, r.studentId), eq(reportCards.classId, input.classId))).orderBy(desc(reportCards.version)).all();
      const latest = cards[0];
      return { studentId: r.studentId, firstName: r.firstName, lastName: r.lastName, count: cards.length, latest: latest ? { id: latest.id, version: latest.version, generatedAt: latest.generatedAt, publishedAt: latest.publishedAt } : null };
    });
  }),

  versions: adminOrTeacherProcedure.input(z.object({ classId: ID, studentId: ID })).query(({ ctx, input }) => {
    assertClassAccess(ctx, input.classId);
    return db.select({ id: reportCards.id, version: reportCards.version, generatedAt: reportCards.generatedAt, publishedAt: reportCards.publishedAt, generatedByName: reportCards.generatedByName }).from(reportCards).where(and(eq(reportCards.studentId, input.studentId), eq(reportCards.classId, input.classId))).orderBy(desc(reportCards.version)).all();
  }),

  // ── Publish (admin only) ─────────────────────────────────────────────────────
  /** Publish the LATEST card for every student in the class (parents see published only). */
  publishClass: adminProcedure.input(z.object({ classId: ID, published: z.boolean().default(true) })).mutation(({ ctx, input }) => {
    const roster = db.select({ studentId: enrollments.studentId }).from(enrollments).where(and(eq(enrollments.classId, input.classId), eq(enrollments.status, 'active'))).all();
    const ts = now();
    let n = 0;
    db.transaction((tx) => {
      for (const r of roster) {
        const latest = tx.select().from(reportCards).where(and(eq(reportCards.studentId, r.studentId), eq(reportCards.classId, input.classId))).orderBy(desc(reportCards.version)).limit(1).get();
        if (!latest) continue;
        tx.update(reportCards).set({ publishedAt: input.published ? ts : null, updatedAt: ts }).where(eq(reportCards.id, latest.id)).run();
        n++;
      }
    });
    audit(auditActor(ctx), input.published ? 'reportcard.publish' : 'reportcard.unpublish', { entity: 'class', entityId: input.classId, detail: { count: n } });
    return { count: n };
  }),

  /** Publish/unpublish a single card version. */
  setPublish: adminProcedure.input(z.object({ id: ID, published: z.boolean() })).mutation(({ ctx, input }) => {
    const card = db.select({ id: reportCards.id, classId: reportCards.classId }).from(reportCards).where(eq(reportCards.id, input.id)).get();
    if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report card not found.' });
    db.update(reportCards).set({ publishedAt: input.published ? now() : null, updatedAt: now() }).where(eq(reportCards.id, input.id)).run();
    audit(auditActor(ctx), input.published ? 'reportcard.publish' : 'reportcard.unpublish', { entity: 'class', entityId: card.classId, detail: { cardId: input.id } });
    return { ok: true as const };
  }),

  // ── Transcripts (cumulative; admin-only, generate/read/publish) ───────────────
  transcriptGenerate: adminProcedure.input(z.object({ studentId: ID })).mutation(async ({ ctx, input }) => {
    if (!db.select({ id: students.id }).from(students).where(eq(students.id, input.studentId)).get()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Student not found.' });
    return generateTranscript(input.studentId, auditActor(ctx));
  }),

  transcriptVersions: adminProcedure.input(z.object({ studentId: ID })).query(({ input }) =>
    db.select({ id: transcripts.id, version: transcripts.version, generatedAt: transcripts.generatedAt, publishedAt: transcripts.publishedAt, generatedByName: transcripts.generatedByName }).from(transcripts).where(eq(transcripts.studentId, input.studentId)).orderBy(desc(transcripts.version)).all(),
  ),

  transcriptSetPublish: adminProcedure.input(z.object({ id: ID, published: z.boolean() })).mutation(({ ctx, input }) => {
    const tr = db.select({ id: transcripts.id, studentId: transcripts.studentId }).from(transcripts).where(eq(transcripts.id, input.id)).get();
    if (!tr) throw new TRPCError({ code: 'NOT_FOUND', message: 'Transcript not found.' });
    db.update(transcripts).set({ publishedAt: input.published ? now() : null, updatedAt: now() }).where(eq(transcripts.id, input.id)).run();
    audit(auditActor(ctx), input.published ? 'transcript.publish' : 'transcript.unpublish', { entity: 'student', entityId: tr.studentId, detail: { transcriptId: input.id } });
    return { ok: true as const };
  }),
});
