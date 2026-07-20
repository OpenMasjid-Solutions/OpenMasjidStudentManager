// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * SMTP settings + recipients + graceful degradation (CLAUDE.md §4/§10). The actual send needs a real
 * mail server (integration), so here we verify: the config round-trips, the admin API keeps the
 * password WRITE-ONLY (never returned; merged when omitted), guardian emails resolve for a family,
 * and every sender no-ops safely when SMTP is off.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { guardians, guardianFamilies, families, students, settings } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let settingsMod: typeof import('../src/settings');
let smtp: typeof import('../src/mail/smtp');
let notify: typeof import('../src/mail/notify');
let recips: typeof import('../src/mail/recipients');
const caller = (role: Role) => app.appRouter.createCaller(makeCtx({ origin: 'lan', session: { role, source: 'local', username: role, userId: `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
  settingsMod = await import('../src/settings');
  smtp = await import('../src/mail/smtp');
  notify = await import('../src/mail/notify');
  recips = await import('../src/mail/recipients');
});
beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [guardianFamilies, guardians, students, families, settings]) db.delete(t).run();
});

describe('SMTP config round-trip', () => {
  it('is null by default; stores + reads back; smtpConfigured tracks it', () => {
    expect(settingsMod.getSmtp()).toBeNull();
    expect(smtp.smtpConfigured()).toBe(false);
    settingsMod.setSmtp({ host: 'smtp.test', port: 587, secure: false, user: 'u', pass: 'secret', from: 'S <o@test.org>' });
    expect(smtp.smtpConfigured()).toBe(true);
    expect(settingsMod.getSmtp()).toMatchObject({ host: 'smtp.test', port: 587, secure: false, user: 'u', pass: 'secret', from: 'S <o@test.org>' });
  });
});

describe('settings router — SMTP password is write-only', () => {
  it('smtpGet never returns the password; smtpSet merges it when omitted', async () => {
    const admin = caller('admin');
    await admin.settings.smtpSet({ host: 'smtp.test', port: 587, secure: false, user: 'u', from: 'S <o@test.org>', password: 'secret' });
    const got = await admin.settings.smtpGet();
    expect(got).toMatchObject({ configured: true, host: 'smtp.test', hasPassword: true });
    expect(got).not.toHaveProperty('password');
    expect(got).not.toHaveProperty('pass');
    // Change host WITHOUT re-sending the password → the stored password is retained.
    await admin.settings.smtpSet({ host: 'smtp2.test', port: 465, secure: true, user: 'u', from: 'S <o@test.org>' });
    expect(settingsMod.getSmtp()).toMatchObject({ host: 'smtp2.test', port: 465, secure: true, pass: 'secret' });
  });

  it('is admin-only (finance/teacher/parent refused)', async () => {
    for (const r of ['finance', 'teacher', 'parent'] as Role[]) {
      await expect(caller(r).settings.smtpGet()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin').settings.smtpGet()).resolves.toBeTruthy();
    // admin over the tunnel is blocked (origin policy)
    const tunnelAdmin = app.appRouter.createCaller(makeCtx({ origin: 'tunnel', session: { role: 'admin', source: 'local', username: 'admin', userId: 'usr_admin' } }).ctx);
    await expect(tunnelAdmin.settings.smtpGet()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('guardianEmailsForFamily', () => {
  it('returns valid guardian emails, deduped; skips guardians with no/invalid email', async () => {
    const admin = caller('admin');
    const fam = await admin.people.familyCreate({ name: 'Ismail' });
    await admin.people.guardianCreate({ familyId: fam.id, name: 'A', email: 'a@test.org' });
    await admin.people.guardianCreate({ familyId: fam.id, name: 'B', email: 'b@test.org' });
    // A guardian with no email on file (direct insert) must be skipped.
    const { db } = app.dbmod;
    const ts = new Date();
    db.insert(guardians).values({ id: 'grd_none', name: 'C', phone: null, email: null, createdAt: ts, updatedAt: ts }).run();
    db.insert(guardianFamilies).values({ guardianId: 'grd_none', familyId: fam.id, relation: null, isEmergencyContact: false, createdAt: ts }).run();
    expect(recips.guardianEmailsForFamily(fam.id).sort()).toEqual(['a@test.org', 'b@test.org']);
    expect(recips.guardianEmailsForFamily('fam_missing')).toEqual([]);
  });
});

describe('senders degrade gracefully when SMTP is off', () => {
  it('sendReceipt/sendInvite/sendAutopayFailure no-op (0/false) without SMTP', async () => {
    const admin = caller('admin');
    const fam = await admin.people.familyCreate({ name: 'X' });
    await admin.people.guardianCreate({ familyId: fam.id, name: 'A', email: 'a@test.org' });
    expect(await notify.sendReceipt(fam.id, '$50.00')).toBe(0);
    expect(await notify.sendInvite('a@test.org', 'https://x/family/invite?token=t', 'A')).toBe(false);
    expect(await notify.sendAutopayFailure(fam.id, true)).toBe(0);
  });

  it('does not email an invite when there is no absolute base URL (relative link would be dead)', async () => {
    // SMTP configured, but the test env sets no OPENMASJID_PUBLIC_URL → portalBase() is '' → skip the
    // send so the office falls back to the copy/print link instead of a dead relative link.
    settingsMod.setSmtp({ host: 'smtp.test', port: 587, secure: false, user: 'u', pass: 'p', from: 'S <o@test.org>' });
    expect(smtp.smtpConfigured()).toBe(true);
    expect(await notify.sendInvite('a@test.org', '/family/invite?token=t', 'A')).toBe(false);
  });
});
