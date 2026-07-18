// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Comment bank (CLAUDE.md §4/§5): reusable remark snippets. A SHARED bank is admin-managed; each
 * teacher has a PERSONAL bank. Teachers read shared + their own and manage only their own;
 * admin manages shared (admin has no personal bank). Finance/parent never reach here.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, asc } from 'drizzle-orm';
import { router, adminProcedure, adminOrTeacherProcedure, auditActor } from './trpc';
import { db } from '../db';
import { commentSnippets } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';

const ID = z.string().min(1).max(64);
const TEXT = z.string().trim().min(1).max(2000);
const now = () => new Date();

export const commentsRouter = router({
  /** Shared snippets + (for a teacher) their own personal snippets. */
  list: adminOrTeacherProcedure.query(({ ctx }) => {
    const shared = db.select().from(commentSnippets).where(eq(commentSnippets.scope, 'shared')).orderBy(asc(commentSnippets.position), asc(commentSnippets.createdAt)).all();
    const uid = ctx.session.userId;
    const personal = ctx.session.role === 'teacher' && uid
      ? db.select().from(commentSnippets).where(and(eq(commentSnippets.scope, 'personal'), eq(commentSnippets.ownerUserId, uid))).orderBy(asc(commentSnippets.createdAt)).all()
      : [];
    return { shared, personal };
  }),

  /** Create a snippet. Shared → admin only; personal → the calling teacher (owns it). */
  create: adminOrTeacherProcedure.input(z.object({ scope: z.enum(['shared', 'personal']), text: TEXT })).mutation(({ ctx, input }) => {
    if (input.scope === 'shared' && ctx.session.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the office manages shared snippets.' });
    if (input.scope === 'personal' && ctx.session.role !== 'teacher') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only teachers have a personal snippet bank.' });
    const id = rid('csn');
    const ts = now();
    const ownerUserId = input.scope === 'personal' ? ctx.session.userId : null;
    const maxPos = input.scope === 'shared' ? db.select({ p: commentSnippets.position }).from(commentSnippets).where(eq(commentSnippets.scope, 'shared')).all().reduce((m, r) => Math.max(m, r.p), -1) : 0;
    db.insert(commentSnippets).values({ id, scope: input.scope, ownerUserId, text: input.text, position: maxPos + 1, createdAt: ts, updatedAt: ts }).run();
    audit(auditActor(ctx), 'comment.create', { entity: 'commentSnippet', entityId: id, detail: { scope: input.scope } });
    return { id };
  }),

  update: adminOrTeacherProcedure.input(z.object({ id: ID, text: TEXT })).mutation(({ ctx, input }) => {
    const snip = db.select().from(commentSnippets).where(eq(commentSnippets.id, input.id)).get();
    if (!snip) throw new TRPCError({ code: 'NOT_FOUND', message: 'Snippet not found.' });
    assertManageable(ctx, snip);
    db.update(commentSnippets).set({ text: input.text, updatedAt: now() }).where(eq(commentSnippets.id, input.id)).run();
    audit(auditActor(ctx), 'comment.update', { entity: 'commentSnippet', entityId: input.id });
    return { ok: true as const };
  }),

  remove: adminOrTeacherProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const snip = db.select().from(commentSnippets).where(eq(commentSnippets.id, input.id)).get();
    if (!snip) throw new TRPCError({ code: 'NOT_FOUND', message: 'Snippet not found.' });
    assertManageable(ctx, snip);
    db.delete(commentSnippets).where(eq(commentSnippets.id, input.id)).run();
    audit(auditActor(ctx), 'comment.remove', { entity: 'commentSnippet', entityId: input.id, detail: { scope: snip.scope } });
    return { ok: true as const };
  }),
});

/** A shared snippet is managed by admin; a personal one only by its owning teacher. */
function assertManageable(ctx: Parameters<typeof auditActor>[0], snip: typeof commentSnippets.$inferSelect) {
  if (snip.scope === 'shared') {
    if (ctx.session?.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the office manages shared snippets.' });
    return;
  }
  if (!(ctx.session?.role === 'teacher' && ctx.session.userId && snip.ownerUserId === ctx.session.userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only manage your own snippets.' });
  }
}
