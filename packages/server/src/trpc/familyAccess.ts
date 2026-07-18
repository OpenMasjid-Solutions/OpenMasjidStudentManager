// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Parent family-scoping guard for the portal (CLAUDE.md §5, §14 — enforced in queries, never
 * only in the UI). A parent session's userId links (via guardian_users) to exactly one guardian,
 * who may span multiple families (guardian_families). Every portal read is confined to THOSE
 * families' ids / their students' ids. A parent who is linked to nothing sees nothing.
 */
import { TRPCError } from '@trpc/server';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../db';
import { guardianUsers, guardianFamilies, students } from '../db/schema';
import type { Context } from './trpc';

/** The family ids this parent session may see (via its guardian link). Empty if unlinked. */
export function parentFamilyIds(ctx: Context): string[] {
  const uid = ctx.session?.userId;
  if (!uid) return [];
  const links = db.select({ guardianId: guardianUsers.guardianId }).from(guardianUsers).where(eq(guardianUsers.userId, uid)).all();
  if (!links.length) return [];
  const gids = links.map((l) => l.guardianId);
  return db.select({ familyId: guardianFamilies.familyId }).from(guardianFamilies).where(inArray(guardianFamilies.guardianId, gids)).all().map((r) => r.familyId);
}

/** The active student ids in this parent's families (the kids they may see). */
export function parentStudentIds(ctx: Context): string[] {
  const famIds = parentFamilyIds(ctx);
  if (!famIds.length) return [];
  return db.select({ id: students.id }).from(students).where(inArray(students.familyId, famIds)).all().map((r) => r.id);
}

/** Throw unless this parent session is linked to `familyId`. */
export function assertFamilyAccess(ctx: Context, familyId: string): void {
  if (!parentFamilyIds(ctx).includes(familyId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You don’t have access to that.' });
  }
}
