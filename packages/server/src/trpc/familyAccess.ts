// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Parent family-scoping guard for the portal (CLAUDE.md §5, §14 — enforced in queries, never
 * only in the UI). A parent session's userId links (via guardian_users) to exactly one guardian,
 * who may span multiple families (guardian_families). Every portal read is confined to THOSE
 * families' ids / their students' ids. A parent who is linked to nothing sees nothing.
 *
 * The userId-based helpers are also used by the authed report-card serving route (a plain Fastify
 * route that has a session, not a tRPC ctx) to gate a parent to their own kids' published PDFs.
 */
import { TRPCError } from '@trpc/server';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../db';
import { guardianUsers, guardianFamilies, students } from '../db/schema';
import type { Context } from './trpc';

/** Family ids linked to this user (via its guardian). Empty if unlinked / not a parent. */
export function familyIdsForUser(userId: string | null | undefined): string[] {
  if (!userId) return [];
  const links = db.select({ guardianId: guardianUsers.guardianId }).from(guardianUsers).where(eq(guardianUsers.userId, userId)).all();
  if (!links.length) return [];
  const gids = links.map((l) => l.guardianId);
  return db.select({ familyId: guardianFamilies.familyId }).from(guardianFamilies).where(inArray(guardianFamilies.guardianId, gids)).all().map((r) => r.familyId);
}

/** Active student ids in this user's families (the kids they may see). */
export function studentIdsForUser(userId: string | null | undefined): string[] {
  const famIds = familyIdsForUser(userId);
  if (!famIds.length) return [];
  return db.select({ id: students.id }).from(students).where(inArray(students.familyId, famIds)).all().map((r) => r.id);
}

/** The family ids this parent session may see. */
export function parentFamilyIds(ctx: Context): string[] {
  return familyIdsForUser(ctx.session?.userId);
}

/** The active student ids this parent session may see. */
export function parentStudentIds(ctx: Context): string[] {
  return studentIdsForUser(ctx.session?.userId);
}

/** Throw unless this parent session is linked to `familyId`. */
export function assertFamilyAccess(ctx: Context, familyId: string): void {
  if (!parentFamilyIds(ctx).includes(familyId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You don’t have access to that.' });
  }
}

/** Throw unless `studentId` is one of this parent session's kids. */
export function assertStudentAccess(ctx: Context, studentId: string): void {
  if (!parentStudentIds(ctx).includes(studentId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You don’t have access to that.' });
  }
}
