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
import { and, eq, isNull, sql } from 'drizzle-orm';
import { router, publicProcedure, protectedProcedure, adminOrFinanceProcedure, auditActor } from './trpc';
import { db } from '../db';
import { users, guardians, guardianUsers, invites, type Role } from '../db/schema';
import { rid } from '../db/ids';
import { hashPassword, verifyPassword, dummyHash, MIN_PASSWORD_LENGTH } from '../auth/passwords';
import { createSession, destroySession, cookieOptions, COOKIE, COOKIE_PATH, SSO_SESSION_TTL_MS, hashToken } from '../auth/sessions';
import { probePlatformSession } from '../fabric/platform';
import { fabricConfigured, config } from '../config';
import { clientIp } from '../security/origin';
import { loginLimiter, inviteAcceptLimiter } from '../security/rateLimit';
import { audit } from '../audit';
import { mintInvite } from '../auth/invites';
import { sendInvite } from '../mail/notify';

const USERNAME = z.string().trim().min(1).max(254); // fits a full email (parent portal logins)
const PASSWORD = z.string().min(1).max(200);
const ID = z.string().min(1).max(64);
const TOKEN = z.string().min(1).max(200);

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
      // Surface the forced-password-change flag so the UI can gate (staff temp passwords).
      let mustChangePassword = false;
      if (ctx.session.userId) {
        const u = db.select({ m: users.mustChangePassword }).from(users).where(eq(users.id, ctx.session.userId)).get();
        mustChangePassword = !!u?.m;
      }
      return {
        authenticated: true as const,
        origin: ctx.origin,
        setupRequired: false,
        user: { role: ctx.session.role, username: ctx.session.username ?? undefined, source: ctx.session.source, mustChangePassword },
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
          user: { role: 'admin' as Role, username: probe.username, source: 'sso' as const, mustChangePassword: false },
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

      // Case-insensitive match: parent accounts store the guardian email lowercased, and phone
      // keyboards auto-capitalize — so a case-sensitive lookup would lock legitimate users out.
      // Works for existing mixed-case admin/staff usernames too (compared via lower()).
      const uname = input.username.trim().toLowerCase();
      const user = db.select().from(users).where(sql`lower(${users.username}) = ${uname}`).get();
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
    ctx.res.clearCookie(COOKIE, { path: COOKIE_PATH }); // must match the Path the cookie was set with (RFC 6265)
    return { ok: true as const };
  }),

  /** Change your own password (used for the forced change on a staff temp password). */
  changePassword: protectedProcedure
    .input(z.object({ currentPassword: PASSWORD, newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.userId;
      if (!userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'There is no local password to change for this session.' });
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your current password is incorrect.' });
      }
      db.update(users).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, userId)).run();
      return { ok: true as const };
    }),

  // ── Parent portal: invites (CLAUDE.md §12) ──────────────────────────────────
  /** finance/admin creates a one-time portal invite for a guardian. Returns the link to share —
   *  emailed once SMTP lands; for now the office copies/prints it. The guardian needs an email
   *  (it becomes their portal login) and must not already have an account. */
  inviteCreate: adminOrFinanceProcedure.input(z.object({ guardianId: ID })).mutation(async ({ ctx, input }) => {
    const r = mintInvite(input.guardianId, ctx.session.userId ?? null);
    if (!r.ok) {
      const msg =
        r.reason === 'guardian_not_found'
          ? 'Guardian not found.'
          : r.reason === 'no_email'
            ? 'Add an email for this guardian before inviting them to the portal.'
            : r.reason === 'already_account'
              ? 'This guardian already has a portal account.'
              : 'That email is already used by another account.';
      throw new TRPCError({ code: r.reason === 'guardian_not_found' ? 'NOT_FOUND' : r.reason === 'no_email' ? 'BAD_REQUEST' : 'CONFLICT', message: msg });
    }
    audit(auditActor(ctx), 'invite.create', { entity: 'guardian', entityId: input.guardianId });
    // Email the link when SMTP is set up; ALWAYS return the link too, so the office can copy/print it
    // (and so a failed send never blocks the invite) — graceful degradation, §4/§12.
    const emailed = await sendInvite(r.email, r.url, r.guardianName);
    return { token: r.token, url: r.url, email: r.email, guardianName: r.guardianName, emailed };
  }),

  /** Look up a pending invite (for the accept page to greet the guardian). Uniform invalid
   *  response — tokens are 256-bit, so there is nothing to enumerate. */
  inviteInfo: publicProcedure.input(z.object({ token: TOKEN })).query(({ input }) => {
    const inv = db.select().from(invites).where(and(eq(invites.tokenHash, hashToken(input.token)), isNull(invites.usedAt))).get();
    if (!inv || inv.expiresAt.getTime() <= Date.now()) return { valid: false as const };
    const g = db.select({ name: guardians.name }).from(guardians).where(eq(guardians.id, inv.guardianId)).get();
    if (!g) return { valid: false as const };
    return { valid: true as const, guardianName: g.name };
  }),

  /** Accept a portal invite: set a password → create the parent account + guardian link → sign in.
   *  Rate-limited per IP; single-use is re-checked inside the transaction to close the race. */
  inviteAccept: publicProcedure
    .input(z.object({ token: TOKEN, password: z.string().min(MIN_PASSWORD_LENGTH).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const key = clientIp(ctx.req);
      const wait = inviteAcceptLimiter.retryAfterMs(key);
      if (wait > 0) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.` });

      const inv = db.select().from(invites).where(and(eq(invites.tokenHash, hashToken(input.token)), isNull(invites.usedAt))).get();
      const g = inv ? db.select().from(guardians).where(eq(guardians.id, inv.guardianId)).get() : null;
      const email = (g?.email ?? '').trim().toLowerCase();
      const valid =
        !!inv &&
        inv.expiresAt.getTime() > Date.now() &&
        !!g &&
        !!email &&
        !db.select({ userId: guardianUsers.userId }).from(guardianUsers).where(eq(guardianUsers.guardianId, g.id)).get() &&
        !db.select({ id: users.id }).from(users).where(eq(users.username, email)).get();
      if (!valid) {
        inviteAcceptLimiter.fail(key);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invite link is invalid or has already been used. Ask the office for a new one.' });
      }

      const passwordHash = await hashPassword(input.password); // hash BEFORE the txn (no await inside)
      const userId = rid('usr');
      const ts = new Date();
      const created = db.transaction((tx) => {
        // Re-check single-use + uniqueness atomically (closes a double-accept race).
        const live = tx.select({ usedAt: invites.usedAt }).from(invites).where(eq(invites.id, inv!.id)).get();
        if (!live || live.usedAt) return false;
        if (tx.select({ userId: guardianUsers.userId }).from(guardianUsers).where(eq(guardianUsers.guardianId, g!.id)).get()) return false;
        if (tx.select({ id: users.id }).from(users).where(eq(users.username, email)).get()) return false;
        tx.insert(users).values({ id: userId, username: email, email, passwordHash, role: 'parent', status: 'active', mustChangePassword: false, displayName: g!.name, createdAt: ts, updatedAt: ts }).run();
        tx.insert(guardianUsers).values({ guardianId: g!.id, userId, createdAt: ts }).run();
        tx.update(invites).set({ usedAt: ts }).where(eq(invites.id, inv!.id)).run();
        return true;
      });
      if (!created) {
        inviteAcceptLimiter.fail(key);
        throw new TRPCError({ code: 'CONFLICT', message: 'This invite could not be completed. Ask the office for a new one.' });
      }
      inviteAcceptLimiter.succeed(key);
      audit({ userId, role: 'parent', name: g!.name }, 'invite.accept', { entity: 'guardian', entityId: g!.id });
      const { token } = createSession({ userId, role: 'parent', source: 'local', username: email });
      ctx.res.setCookie(COOKIE, token, cookieOptions(ctx.https));
      return { ok: true as const, role: 'parent' as Role };
    }),
});
