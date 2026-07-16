// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Auth router (CLAUDE.md §12, §14): session state, first-run admin setup, password
 * login, logout, and the OpenMasjidOS SSO fast-path. Origin policy is enforced HERE
 * for the public login/setup mutations and in trpc.ts middleware for every protected
 * call. Errors are friendly + generic: over the tunnel there is no username, role, or
 * password oracle — an unknown user, an inactive user, and an admin (LAN-only) all
 * produce the SAME response, timed constant by verifying against a decoy hash.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from './trpc';
import { db } from '../db';
import { users, type Role } from '../db/schema';
import { rid } from '../db/ids';
import { hashPassword, verifyPassword, dummyHash, MIN_PASSWORD_LENGTH } from '../auth/passwords';
import { createSession, destroySession, cookieOptions, COOKIE, SSO_SESSION_TTL_MS } from '../auth/sessions';
import { probePlatformSession } from '../fabric/platform';
import { fabricConfigured } from '../config';
import { clientIp } from '../security/origin';
import { loginLimiter } from '../security/rateLimit';

const USERNAME = z.string().trim().min(1).max(64);
const PASSWORD = z.string().min(1).max(200);

function hasAnyUser(): boolean {
  return !!db.select({ id: users.id }).from(users).limit(1).get();
}

export const authRouter = router({
  /** Who am I? Also performs the LAN-only SSO upgrade when embedded in OpenMasjidOS. */
  session: publicProcedure.query(async ({ ctx }) => {
    if (ctx.session) {
      // A LAN-minted admin cookie presented over the tunnel is inert (§12.4).
      if (ctx.session.role === 'admin' && ctx.origin === 'tunnel') {
        return { authenticated: false as const, setupRequired: false, origin: ctx.origin, adminBlocked: true };
      }
      return {
        authenticated: true as const,
        origin: ctx.origin,
        setupRequired: false,
        user: { role: ctx.session.role, username: ctx.session.username ?? undefined, source: ctx.session.source },
      };
    }

    // SSO fast-path — LAN only, only when the platform has wired us in.
    if (fabricConfigured() && ctx.origin === 'lan') {
      const probe = await probePlatformSession(ctx.req.headers.cookie);
      if (probe.username) {
        const { token } = createSession({ role: 'admin', source: 'sso', username: probe.username, ttlMs: SSO_SESSION_TTL_MS });
        ctx.res.setCookie(COOKIE, token, cookieOptions(ctx.https, SSO_SESSION_TTL_MS));
        return {
          authenticated: true as const,
          origin: ctx.origin,
          setupRequired: false,
          user: { role: 'admin' as Role, username: probe.username, source: 'sso' as const },
        };
      }
    }

    return { authenticated: false as const, origin: ctx.origin, setupRequired: !hasAnyUser() };
  }),

  /** First-run: create the single admin account. LAN only, and only when empty. */
  setup: publicProcedure
    .input(z.object({ username: USERNAME, password: z.string().min(MIN_PASSWORD_LENGTH).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Origin FIRST — over the tunnel this always returns the same message whether or
      // not the app is set up yet (no install-state oracle to the internet, §14).
      if (ctx.origin !== 'lan') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Set up the admin account on the masjid network.' });
      }
      const now = new Date();
      const id = rid('usr');
      const passwordHash = await hashPassword(input.password); // hash BEFORE the txn (no await inside it)
      // Atomic check-and-insert closes the first-run race (two concurrent setups can't
      // both create an admin) — the UNIQUE username constraint wouldn't catch differing names.
      const created = db.transaction((tx) => {
        if (tx.select({ id: users.id }).from(users).limit(1).get()) return false;
        tx.insert(users)
          .values({
            id,
            username: input.username,
            passwordHash,
            role: 'admin',
            status: 'active',
            mustChangePassword: false,
            displayName: input.username,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return true;
      });
      if (!created) throw new TRPCError({ code: 'CONFLICT', message: 'This app is already set up.' });
      const { token } = createSession({ userId: id, role: 'admin', source: 'local', username: input.username });
      ctx.res.setCookie(COOKIE, token, cookieOptions(ctx.https));
      return { ok: true as const };
    }),

  /** Password login. Rate-limited on the real client IP; constant-time; generic errors. */
  login: publicProcedure
    .input(z.object({ username: USERNAME, password: PASSWORD }))
    .mutation(async ({ ctx, input }) => {
      const key = clientIp(ctx.req);
      const wait = loginLimiter.retryAfterMs(key);
      if (wait > 0) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.` });
      }

      const user = db.select().from(users).where(eq(users.username, input.username)).get();
      const isTunnel = ctx.origin === 'tunnel';
      // A login can legitimately succeed here only for an active account that isn't an
      // admin signing in over the tunnel. Every other case still runs a verify against a
      // decoy hash (constant time) and returns the SAME generic error — no username/role/
      // password oracle over the internet.
      const canAuthHere = !!user && user.status === 'active' && !(user.role === 'admin' && isTunnel);
      const target = canAuthHere ? user!.passwordHash : await dummyHash();
      const passwordOk = await verifyPassword(target, input.password);
      if (!canAuthHere || !passwordOk) {
        loginLimiter.fail(key);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Incorrect username or password.' });
      }

      loginLimiter.succeed(key);
      const { token } = createSession({ userId: user!.id, role: user!.role, source: 'local', username: user!.username });
      ctx.res.setCookie(COOKIE, token, cookieOptions(ctx.https));
      return { ok: true as const, role: user!.role, mustChangePassword: user!.mustChangePassword };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    destroySession(ctx.token);
    ctx.res.clearCookie(COOKIE, { path: '/' });
    return { ok: true as const };
  }),
});
