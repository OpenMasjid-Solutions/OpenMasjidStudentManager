// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Password reset (CLAUDE.md §12/§14): a generic request (no account-enumeration oracle), token
 * validity, and a single-use confirm that changes the password and signs the user out everywhere.
 * The email send itself is integration (needs SMTP + a public URL); here we drive the token directly.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshApp, makeCtx } from './harness';
import { users, passwordResets, sessions } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let hashToken: (t: string) => string;
const STRONG = 'correct-horse-battery';
const NEWPW = 'new-horse-battery-staple';
const lan = () => app.appRouter.createCaller(makeCtx({ origin: 'lan' }).ctx);

beforeAll(async () => {
  app = await freshApp();
  ({ hashToken } = await import('../src/auth/sessions'));
});
beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [passwordResets, sessions, users]) db.delete(t).run();
});

async function makeAdmin() {
  await lan().auth.setup({ username: 'admin', password: STRONG });
  return app.dbmod.db.select().from(users).where(eq(users.username, 'admin')).get()!;
}
function insertReset(userId: string, token: string, opts: { expiresInMs?: number; usedAt?: Date | null } = {}) {
  const ts = new Date();
  app.dbmod.db
    .insert(passwordResets)
    .values({ id: 'pwr_' + token, tokenHash: hashToken(token), userId, createdAt: ts, expiresAt: new Date(ts.getTime() + (opts.expiresInMs ?? 3_600_000)), usedAt: opts.usedAt ?? null })
    .run();
}

describe('resetRequest — generic (no enumeration)', () => {
  it('returns { ok: true } for a matching AND a non-matching email, and never throws', async () => {
    await makeAdmin();
    expect(await lan().auth.resetRequest({ email: 'admin' })).toEqual({ ok: true });
    expect(await lan().auth.resetRequest({ email: 'nobody@nowhere.test' })).toEqual({ ok: true });
  });
});

describe('resetInfo', () => {
  it('valid for a live token; invalid for expired / used / unknown', async () => {
    const admin = await makeAdmin();
    insertReset(admin.id, 'live');
    insertReset(admin.id, 'expired', { expiresInMs: -1000 });
    insertReset(admin.id, 'used', { usedAt: new Date() });
    expect((await lan().auth.resetInfo({ token: 'live' })).valid).toBe(true);
    expect((await lan().auth.resetInfo({ token: 'expired' })).valid).toBe(false);
    expect((await lan().auth.resetInfo({ token: 'used' })).valid).toBe(false);
    expect((await lan().auth.resetInfo({ token: 'nope' })).valid).toBe(false);
  });
});

describe('resetConfirm', () => {
  it('sets the new password (old fails, new works), is single-use, and kills existing sessions', async () => {
    const admin = await makeAdmin();
    const { db } = app.dbmod;
    const ts = new Date();
    db.insert(sessions).values({ id: 'ses_x', tokenHash: 'h', userId: admin.id, role: 'admin', source: 'local', username: 'admin', createdAt: ts, expiresAt: new Date(ts.getTime() + 3_600_000), lastSeenAt: ts }).run();
    insertReset(admin.id, 'tok1');

    expect(await lan().auth.resetConfirm({ token: 'tok1', password: NEWPW })).toEqual({ ok: true });
    // Existing sessions for the user are gone (§14).
    expect(db.select().from(sessions).where(eq(sessions.userId, admin.id)).all().length).toBe(0);
    // Single-use: the token can't be replayed.
    await expect(lan().auth.resetConfirm({ token: 'tok1', password: NEWPW })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // The old password no longer works; the new one does (login on the LAN as admin).
    await expect(lan().auth.login({ username: 'admin', password: STRONG })).rejects.toBeTruthy();
    await expect(lan().auth.login({ username: 'admin', password: NEWPW })).resolves.toBeTruthy();
  });

  it('rejects an expired token', async () => {
    const admin = await makeAdmin();
    insertReset(admin.id, 'old', { expiresInMs: -1000 });
    await expect(lan().auth.resetConfirm({ token: 'old', password: NEWPW })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
