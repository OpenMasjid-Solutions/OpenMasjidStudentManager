// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Staff user management (CLAUDE.md §12): admin creates finance accounts with a temporary
 * password (forced change on first login), can disable them (revokes live sessions on the
 * next request via getSession's status re-check) and reset passwords. Admin-only; never
 * returns password hashes; audited.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { router, adminProcedure, auditActor } from './trpc';
import { db } from '../db';
import { users } from '../db/schema';
import { rid } from '../db/ids';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/passwords';
import { audit } from '../audit';

const USERNAME = z.string().trim().min(1).max(64);
const TEMP_PW = z.string().min(MIN_PASSWORD_LENGTH).max(200);
const now = () => new Date();

export const staffRouter = router({
  list: adminProcedure.query(() =>
    db
      .select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role, status: users.status, phone: users.phone, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.role, 'finance'))
      .all(),
  ),

  create: adminProcedure
    .input(z.object({ username: USERNAME, displayName: z.string().trim().max(120).optional(), role: z.literal('finance'), phone: z.string().trim().max(40).optional(), tempPassword: TEMP_PW }))
    .mutation(async ({ ctx, input }) => {
      if (db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get()) {
        throw new TRPCError({ code: 'CONFLICT', message: 'That username is already taken.' });
      }
      const id = rid('usr');
      const ts = now();
      db.insert(users)
        .values({ id, username: input.username, passwordHash: await hashPassword(input.tempPassword), role: input.role, status: 'active', displayName: input.displayName?.trim() || input.username, phone: input.phone?.trim() || null, mustChangePassword: true, createdAt: ts, updatedAt: ts })
        .run();
      audit(auditActor(ctx), 'staff.create', { entity: 'user', entityId: id, detail: { role: input.role, username: input.username } });
      return { id };
    }),

  setStatus: adminProcedure.input(z.object({ userId: z.string(), status: z.enum(['active', 'disabled']) })).mutation(({ ctx, input }) => {
    const u = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    if (u.role === 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin accounts can’t be disabled here.' });
    db.update(users).set({ status: input.status, updatedAt: now() }).where(eq(users.id, input.userId)).run();
    audit(auditActor(ctx), 'staff.setStatus', { entity: 'user', entityId: input.userId, detail: { status: input.status } });
    return { ok: true as const };
  }),

  resetPassword: adminProcedure.input(z.object({ userId: z.string(), tempPassword: TEMP_PW })).mutation(async ({ ctx, input }) => {
    const u = db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId)).get();
    if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    db.update(users).set({ passwordHash: await hashPassword(input.tempPassword), mustChangePassword: true, updatedAt: now() }).where(eq(users.id, input.userId)).run();
    audit(auditActor(ctx), 'staff.resetPassword', { entity: 'user', entityId: input.userId });
    return { ok: true as const };
  }),
});
