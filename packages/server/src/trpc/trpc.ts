// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * tRPC init, request context, and the role + origin middleware (CLAUDE.md §5, §12.4).
 * EVERY authenticated procedure is built from `requireAuth`, which enforces BOTH the
 * required role AND the access-origin policy (admin = LAN only) — server-side, never
 * only in the UI. Per-procedure origin overrides are forbidden (add a role-scoped
 * procedure below instead of hand-rolling checks).
 */
import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { classifyOrigin, isHttpsRequest, roleAllowedFromOrigin, type Origin } from '../security/origin';
import { getSession, touchSession, COOKIE } from '../auth/sessions';
import type { Role, Session } from '../db/schema';

export function createContext({ req, res }: CreateFastifyContextOptions) {
  const origin: Origin = classifyOrigin(req);
  const token = req.cookies?.[COOKIE];
  const session = getSession(token);
  return { req, res, origin, https: isHttpsRequest(req), token, session };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/** Build a middleware that requires a live session, an allowed role, and a permitted
 *  origin. `allowed = 'any'` means any authenticated role. */
function requireAuth(allowed: readonly Role[] | 'any') {
  return middleware(({ ctx, next }) => {
    const session = ctx.session;
    if (!session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please sign in.' });

    // Origin policy at session-USE time (not just at login): a LAN-minted admin cookie
    // presented over the tunnel is refused (§12.4).
    if (!roleAllowedFromOrigin(session.role, ctx.origin)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Admin access only works on the masjid network.',
      });
    }

    if (allowed !== 'any' && !allowed.includes(session.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You don’t have access to that.' });
    }

    if (ctx.token) touchSession(ctx.token);
    return next({ ctx: { ...ctx, session: session as Session, user: session } });
  });
}

export const protectedProcedure = t.procedure.use(requireAuth('any'));
export const adminProcedure = t.procedure.use(requireAuth(['admin']));
export const financeProcedure = t.procedure.use(requireAuth(['finance']));
export const parentProcedure = t.procedure.use(requireAuth(['parent']));
/** Directory + billing reads/writes that finance shares with admin (§5). */
export const adminOrFinanceProcedure = t.procedure.use(requireAuth(['admin', 'finance']));

/** The audit actor for the current session (§14) — SSO admins have no user row. */
export function auditActor(ctx: Context): { userId: string | null; role: string; name: string | null } {
  return {
    userId: ctx.session?.userId ?? null,
    role: ctx.session?.role ?? 'unknown',
    name: ctx.session?.username ?? null,
  };
}
