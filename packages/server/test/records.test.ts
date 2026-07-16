// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Record extras (CLAUDE.md §4/§5/§9/§14): typed custom-field validation, and the walls —
 * finance may read custom fields but never notes/incidents; teacher/parent are denied for
 * now; incidents default to NOT visible to parents; note/incident bodies never hit audit.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshApp, makeCtx } from './harness';
import { families, students, studentFieldDefs, studentFieldValues, studentNotes, incidents, auditLog } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let studentId: string;

const caller = (role: Role, origin: 'lan' | 'tunnel' = 'lan') =>
  app.appRouter.createCaller(makeCtx({ origin, session: { role, source: 'local', username: role, userId: `usr_${role}` } }).ctx);

beforeAll(async () => {
  app = await freshApp();
});

beforeEach(async () => {
  const { db } = app.dbmod;
  db.delete(studentFieldValues).run();
  db.delete(studentFieldDefs).run();
  db.delete(studentNotes).run();
  db.delete(incidents).run();
  db.delete(students).run();
  db.delete(families).run();
  db.delete(auditLog).run();
  const admin = caller('admin');
  const fam = await admin.people.familyCreate({ name: 'Fam' });
  const s = await admin.people.studentCreate({ familyId: fam.id, firstName: 'A', lastName: 'B' });
  studentId = s.id;
});

describe('custom fields', () => {
  it('admin defines fields; finance/teacher/parent cannot define; finance may read defs, teacher/parent cannot', async () => {
    await caller('admin').records.fieldDefCreate({ label: 'Juz completed', type: 'number' });
    for (const r of ['finance', 'teacher', 'parent'] as const) {
      await expect(caller(r).records.fieldDefCreate({ label: 'x', type: 'text' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await caller('finance').records.fieldDefsList()).toHaveLength(1);
    await expect(caller('teacher').records.fieldDefsList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('validates values against the field type', async () => {
    const admin = caller('admin');
    const num = await admin.records.fieldDefCreate({ label: 'Juz', type: 'number' });
    const sel = await admin.records.fieldDefCreate({ label: 'Level', type: 'select', options: ['Beginner', 'Advanced'] });
    await expect(admin.records.fieldValueSet({ studentId, defId: num.id, value: 'abc' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await admin.records.fieldValueSet({ studentId, defId: num.id, value: '12' });
    await expect(admin.records.fieldValueSet({ studentId, defId: sel.id, value: 'Nope' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await admin.records.fieldValueSet({ studentId, defId: sel.id, value: 'Advanced' });
    const vals = await caller('finance').records.fieldValuesForStudent({ studentId }); // finance may read values (§5)
    expect(vals.map((v) => v.value).sort()).toEqual(['12', 'Advanced']);
  });

  it('finance can read values but not write; teacher/parent cannot read values', async () => {
    const admin = caller('admin');
    const d = await admin.records.fieldDefCreate({ label: 'Prev madrasa', type: 'text' });
    await expect(caller('finance').records.fieldValueSet({ studentId, defId: d.id, value: 'y' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('teacher').records.fieldValuesForStudent({ studentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('parent').records.fieldValuesForStudent({ studentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('clearing a value removes it', async () => {
    const admin = caller('admin');
    const d = await admin.records.fieldDefCreate({ label: 'Walī', type: 'text' });
    await admin.records.fieldValueSet({ studentId, defId: d.id, value: 'Abu Bakr' });
    expect(await admin.records.fieldValuesForStudent({ studentId })).toHaveLength(1);
    await admin.records.fieldValueSet({ studentId, defId: d.id, value: '' });
    expect(await admin.records.fieldValuesForStudent({ studentId })).toHaveLength(0);
  });
});

describe('staff notes — staff-eyes-only', () => {
  it('admin adds/reads; finance/parent/teacher are denied; the body never reaches audit', async () => {
    const admin = caller('admin');
    await admin.records.noteAdd({ studentId, body: 'Confidential staff observation' });
    expect(await admin.records.notesForStudent({ studentId })).toHaveLength(1);
    for (const r of ['finance', 'parent', 'teacher'] as const) {
      await expect(caller(r).records.notesForStudent({ studentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(r).records.noteAdd({ studentId, body: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const entries = app.dbmod.db.select().from(auditLog).where(eq(auditLog.action, 'note.add')).all();
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0].detail ?? {})).not.toContain('Confidential');
  });
});

describe('incidents', () => {
  it('default visibleToParents is OFF; admin toggles it; finance never sees incidents', async () => {
    const admin = caller('admin');
    const inc = await admin.records.incidentAdd({ studentId, date: '2026-07-16', category: 'Behaviour', description: 'Repeatedly late' });
    const list = await admin.records.incidentsForStudent({ studentId });
    expect(list[0].visibleToParents).toBe(false); // OFF by default (§4/§14)
    await admin.records.incidentSetVisibility({ id: inc.id, visibleToParents: true });
    expect((await admin.records.incidentsForStudent({ studentId }))[0].visibleToParents).toBe(true);
    await expect(caller('finance').records.incidentsForStudent({ studentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('finance').records.incidentAdd({ studentId, date: '2026-07-16', category: 'x', description: 'y' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('parent').records.incidentsForStudent({ studentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
