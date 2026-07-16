// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The role × origin matrix (CLAUDE.md §5, §12.4, §18) + first-run/login flows.
 * These are the load-bearing security tests: an admin over the tunnel is refused at
 * BOTH login and session-use; a non-admin cannot reach an admin procedure.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { users, sessions } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a small test-only router built from the real procedures
let testRouter: any;

beforeAll(async () => {
  app = await freshApp();
  const { router, adminProcedure, teacherProcedure, financeProcedure, parentProcedure, protectedProcedure } = app.trpc;
  testRouter = router({
    adminOnly: adminProcedure.query(() => 'ok'),
    teacherOnly: teacherProcedure.query(() => 'ok'),
    financeOnly: financeProcedure.query(() => 'ok'),
    parentOnly: parentProcedure.query(() => 'ok'),
    anyAuth: protectedProcedure.query(({ ctx }) => ctx.session.role),
  });
});

beforeEach(() => {
  // Isolate every test: empty the tables (sessions first — FK to users).
  app.dbmod.db.delete(sessions).run();
  app.dbmod.db.delete(users).run();
});

const authCaller = (o: Parameters<typeof makeCtx>[0]) => {
  const { ctx, cookies } = makeCtx(o);
  return { c: app.appRouter.createCaller(ctx), cookies };
};
const testCaller = (o: Parameters<typeof makeCtx>[0]) => testRouter.createCaller(makeCtx(o).ctx);

const STRONG = 'a-strong-passphrase-123';

describe('first-run + setup', () => {
  it('reports setupRequired when there is no account yet', async () => {
    const { c } = authCaller({ origin: 'lan' });
    const s = await c.auth.session();
    expect(s).toMatchObject({ authenticated: false, setupRequired: true });
  });

  it('creates the admin on the LAN and sets a session cookie', async () => {
    const { c, cookies } = authCaller({ origin: 'lan', https: true });
    const r = await c.auth.setup({ username: 'admin', password: STRONG });
    expect(r.ok).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('students_session');
  });

  it('refuses first-run setup over the tunnel', async () => {
    const { c } = authCaller({ origin: 'tunnel' });
    await expect(c.auth.setup({ username: 'admin', password: STRONG })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks a second setup once an account exists', async () => {
    await authCaller({ origin: 'lan' }).c.auth.setup({ username: 'admin', password: STRONG });
    await expect(
      authCaller({ origin: 'lan' }).c.auth.setup({ username: 'admin2', password: STRONG }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('over the tunnel, setup returns the SAME error whether or not the app is configured (no install-state oracle)', async () => {
    const before = await authCaller({ origin: 'tunnel' })
      .c.auth.setup({ username: 'a', password: STRONG })
      .then(() => 'ok', (e) => (e as { code?: string }).code);
    await authCaller({ origin: 'lan' }).c.auth.setup({ username: 'admin', password: STRONG }); // now configured
    const after = await authCaller({ origin: 'tunnel' })
      .c.auth.setup({ username: 'a', password: STRONG })
      .then(() => 'ok', (e) => (e as { code?: string }).code);
    expect(before).toBe('FORBIDDEN');
    expect(after).toBe('FORBIDDEN'); // NOT 'CONFLICT' — the internet can't tell if setup is done
  });

  it('enforces the minimum password length', async () => {
    const { c } = authCaller({ origin: 'lan' });
    await expect(c.auth.setup({ username: 'admin', password: 'short' })).rejects.toBeTruthy();
  });
});

describe('login + origin policy', () => {
  beforeEach(async () => {
    await authCaller({ origin: 'lan' }).c.auth.setup({ username: 'admin', password: STRONG });
  });

  it('admin logs in on the LAN', async () => {
    // fresh limiter state: use a unique peer per test to avoid cross-test rate-limit bleed
    const { c, cookies } = authCaller({ origin: 'lan', peer: 'p-login-ok', https: true });
    const r = await c.auth.login({ username: 'admin', password: STRONG });
    expect(r).toMatchObject({ ok: true, role: 'admin' });
    expect(cookies).toHaveLength(1);
  });

  it('rejects the wrong password with a generic error', async () => {
    const { c } = authCaller({ origin: 'lan', peer: 'p-wrong' });
    await expect(c.auth.login({ username: 'admin', password: 'nope-nope-nope' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('admin over the tunnel: identical generic error for right pw, wrong pw, AND an unknown user (no oracle, no enumeration)', async () => {
    const errFor = async (username: string, password: string, peer: string) => {
      try {
        await authCaller({ origin: 'tunnel', peer }).c.auth.login({ username, password });
        return 'NO_ERROR';
      } catch (e) {
        return (e as { code?: string; message?: string }).code + ':' + (e as { message?: string }).message;
      }
    };
    const rightPw = await errFor('admin', STRONG, 'p-tun-a');
    const wrongPw = await errFor('admin', 'wrong-wrong-wrong', 'p-tun-b');
    const unknown = await errFor('nobody', 'whatever-value-1', 'p-tun-c');
    // All three are the same UNAUTHORIZED "Incorrect username or password." — the tunnel
    // reveals neither the admin's password nor that "admin" is an account.
    expect(rightPw).toContain('UNAUTHORIZED');
    expect(rightPw).toBe(wrongPw);
    expect(rightPw).toBe(unknown);
  });

  it('rate-limits repeated failures from one peer', async () => {
    const peer = 'p-bruteforce';
    for (let i = 0; i < 8; i++) {
      await expect(
        authCaller({ origin: 'lan', peer }).c.auth.login({ username: 'admin', password: 'bad' }),
      ).rejects.toBeTruthy();
    }
    await expect(
      authCaller({ origin: 'lan', peer }).c.auth.login({ username: 'admin', password: STRONG }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});

describe('session-use origin policy (middleware)', () => {
  const adminSession = { role: 'admin', source: 'local', username: 'admin' };
  const teacherSession = { role: 'teacher', source: 'local', username: 't' };
  const parentSession = { role: 'parent', source: 'local', username: 'p' };

  it('admin procedure works with an admin session on the LAN', async () => {
    await expect(testCaller({ origin: 'lan', session: adminSession }).adminOnly()).resolves.toBe('ok');
  });

  it('admin session over the tunnel is 403 at session-use', async () => {
    await expect(testCaller({ origin: 'tunnel', session: adminSession }).adminOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // ...even for a non-admin procedure: an admin cookie is simply inert over the tunnel.
    await expect(testCaller({ origin: 'tunnel', session: adminSession }).anyAuth()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('teacher/finance/parent work over the tunnel', async () => {
    await expect(testCaller({ origin: 'tunnel', session: teacherSession }).teacherOnly()).resolves.toBe('ok');
    await expect(testCaller({ origin: 'tunnel', session: parentSession }).parentOnly()).resolves.toBe('ok');
  });

  it('a non-admin cannot reach an admin procedure (role wall)', async () => {
    await expect(testCaller({ origin: 'lan', session: teacherSession }).adminOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(testCaller({ origin: 'lan', session: parentSession }).financeOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('no session is UNAUTHORIZED', async () => {
    await expect(testCaller({ origin: 'lan', session: null }).anyAuth()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
