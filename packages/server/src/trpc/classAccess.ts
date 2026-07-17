// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Shared class-scoping guard for the teacher tools (attendance, gradebook, …). Admin has
 * access to any class; a teacher only to classes they're assigned to (§5) — checked in the
 * query, not the UI. Finance/parent never reach here (the procedure gates to admin|teacher).
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { classes, classTeachers } from '../db/schema';
import type { Context } from './trpc';

export function assertClassAccess(ctx: Context, classId: string): void {
  if (!db.select({ id: classes.id }).from(classes).where(eq(classes.id, classId)).get()) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Class not found.' });
  }
  const role = ctx.session?.role;
  if (role === 'admin') return;
  if (role === 'teacher') {
    const uid = ctx.session?.userId;
    const ok = uid && db.select({ classId: classTeachers.classId }).from(classTeachers).where(and(eq(classTeachers.classId, classId), eq(classTeachers.userId, uid))).get();
    if (!ok) throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only work with your own classes.' });
    return;
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: 'You don’t have access to that.' });
}
