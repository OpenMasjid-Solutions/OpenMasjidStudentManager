// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Comment bank (CLAUDE.md §4/§5): shared bank is admin-managed; each teacher owns a personal
 * bank. Teachers read shared + their own; a teacher can't touch another teacher's personal
 * snippet or a shared one; finance/parent are refused entirely.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshApp, makeCtx } from './harness';
import { commentSnippets, users, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
const caller = (role: Role, opts: { origin?: 'lan' | 'tunnel'; userId?: string } = {}) =>
  app.appRouter.createCaller(makeCtx({ origin: opts.origin ?? 'lan', session: { role, source: 'local', username: role, userId: opts.userId ?? `usr_${role}` } }).ctx);

beforeAll(async () => { app = await freshApp(); });
beforeEach(() => {
  const { db } = app.dbmod;
  db.delete(commentSnippets).run();
  db.delete(users).run();
  db.delete(auditLog).run();
});

describe('shared bank (admin)', () => {
  it('admin creates shared snippets; teachers read them; teachers cannot create shared', async () => {
    const admin = caller('admin');
    await admin.comments.create({ scope: 'shared', text: 'Mashā’Allāh, excellent progress.' });
    const teacher = caller('teacher', { userId: 'usr_t1' });
    expect((await teacher.comments.list()).shared.map((s) => s.text)).toContain('Mashā’Allāh, excellent progress.');
    await expect(teacher.comments.create({ scope: 'shared', text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

/** Real teacher user (personal snippets FK-reference users.id). */
async function makeTeacher(username: string) {
  const { id } = await caller('admin').staff.create({ username, role: 'teacher', tempPassword: 'temp-pass-1234' });
  return { id, call: caller('teacher', { userId: id }) };
}

describe('personal bank (teacher)', () => {
  it('a teacher owns their personal snippets; another teacher cannot see or manage them', async () => {
    const a = await makeTeacher('ustadh1');
    const bTeacher = await makeTeacher('ustadh2');
    const t1 = a.call;
    const t2 = bTeacher.call;
    const { id } = await t1.comments.create({ scope: 'personal', text: 'Needs to focus on tajwīd.' });
    expect((await t1.comments.list()).personal.map((s) => s.text)).toContain('Needs to focus on tajwīd.');
    expect((await t2.comments.list()).personal).toHaveLength(0); // scoped to owner
    await expect(t2.comments.remove({ id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t2.comments.update({ id, text: 'hijack' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await t1.comments.update({ id, text: 'Great tajwīd this term.' });
    await t1.comments.remove({ id });
    expect((await t1.comments.list()).personal).toHaveLength(0);
  });

  it('admin has no personal bank; teacher cannot manage a shared snippet', async () => {
    const admin = caller('admin');
    await expect(admin.comments.create({ scope: 'personal', text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const shared = await admin.comments.create({ scope: 'shared', text: 'Shared one.' });
    const teacher = caller('teacher', { userId: 'usr_t1' });
    await expect(teacher.comments.remove({ id: shared.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await admin.comments.list()).personal).toHaveLength(0);
  });
});

describe('walls', () => {
  it('finance and parent are refused; admin over tunnel refused', async () => {
    for (const r of ['finance', 'parent'] as const) {
      await expect(caller(r).comments.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).comments.create({ scope: 'personal', text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller('admin', { origin: 'tunnel' }).comments.create({ scope: 'shared', text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
