// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Student record extras (CLAUDE.md §4/§5/§9/§14): custom fields, staff notes, incidents.
 * Walls (§5):
 *   - custom-field DEFS: admin writes; admin|finance read (finance needs labels to read values).
 *   - custom-field VALUES: admin writes (validated against the def type); admin|finance read.
 *   - notes (activity log): admin only for now — staff-eyes-only, NEVER finance/parent.
 *   - incidents: admin only for now — finance NEVER; `visibleToParents` defaults OFF.
 * Teacher (own-class students) and parent (shared incidents, own kids) scoped reads are
 * wired once classes/enrollments and portal accounts exist (§20) — until then those roles
 * have no access here (walls err toward deny). Every write is audited; note/incident bodies
 * are never logged.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, asc } from 'drizzle-orm';
import { router, adminProcedure, adminOrFinanceProcedure, auditActor } from './trpc';
import { db } from '../db';
import { students, studentFieldDefs, studentFieldValues, studentNotes, incidents, type StudentFieldDef } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';

const ID = z.string().min(1).max(64);
const LABEL = z.string().trim().min(1).max(80);
const now = () => new Date();

function requireStudent(id: string) {
  const s = db.select({ id: students.id }).from(students).where(eq(students.id, id)).get();
  if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Student not found.' });
  return s;
}

/** Validate a raw value against a field definition; returns the normalized value, or
 *  throws BAD_REQUEST. Empty means "clear" and is handled by the caller. */
function validateValue(def: StudentFieldDef, raw: string): string {
  const v = raw.trim();
  switch (def.type) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(v)) throw new TRPCError({ code: 'BAD_REQUEST', message: `${def.label} must be a number.` });
      return v;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new TRPCError({ code: 'BAD_REQUEST', message: `${def.label} must be a date.` });
      return v;
    case 'select':
      if (!(def.options ?? []).includes(v)) throw new TRPCError({ code: 'BAD_REQUEST', message: `${def.label}: choose one of the allowed options.` });
      return v;
    default:
      return v;
  }
}

export const recordsRouter = router({
  // ── Custom field definitions ───────────────────────────────────────────────
  fieldDefsList: adminOrFinanceProcedure.query(() =>
    db.select().from(studentFieldDefs).orderBy(asc(studentFieldDefs.position), asc(studentFieldDefs.createdAt)).all(),
  ),

  fieldDefCreate: adminProcedure
    .input(
      z.object({
        label: LABEL,
        type: z.enum(['text', 'number', 'date', 'select']),
        options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.type === 'select' && (!input.options || input.options.length === 0)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A “choose one” field needs at least one option.' });
      }
      const id = rid('fld');
      const ts = now();
      const max = db.select({ p: studentFieldDefs.position }).from(studentFieldDefs).orderBy(asc(studentFieldDefs.position)).all();
      const position = (max.at(-1)?.p ?? 0) + 1;
      db.insert(studentFieldDefs)
        .values({ id, label: input.label, type: input.type, options: input.type === 'select' ? input.options : null, position, createdAt: ts, updatedAt: ts })
        .run();
      audit(auditActor(ctx), 'fieldDef.create', { entity: 'fieldDef', entityId: id, detail: { label: input.label, type: input.type } });
      return { id };
    }),

  /** Soft-delete a definition (values keep their meaning, §9). */
  fieldDefArchive: adminProcedure.input(z.object({ id: ID })).mutation(({ ctx, input }) => {
    const def = db.select({ id: studentFieldDefs.id }).from(studentFieldDefs).where(eq(studentFieldDefs.id, input.id)).get();
    if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found.' });
    db.update(studentFieldDefs).set({ archivedAt: now(), updatedAt: now() }).where(eq(studentFieldDefs.id, input.id)).run();
    audit(auditActor(ctx), 'fieldDef.archive', { entity: 'fieldDef', entityId: input.id });
    return { ok: true as const };
  }),

  // ── Custom field values ────────────────────────────────────────────────────
  fieldValuesForStudent: adminOrFinanceProcedure.input(z.object({ studentId: ID })).query(({ input }) => {
    requireStudent(input.studentId);
    return db.select().from(studentFieldValues).where(eq(studentFieldValues.studentId, input.studentId)).all();
  }),

  /** Set (or clear, when value is empty) a custom-field value — validated against the
   *  def's type on every write (§9). */
  fieldValueSet: adminProcedure.input(z.object({ studentId: ID, defId: ID, value: z.string().max(2000) })).mutation(({ ctx, input }) => {
    requireStudent(input.studentId);
    const def = db.select().from(studentFieldDefs).where(eq(studentFieldDefs.id, input.defId)).get();
    if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found.' });
    const ts = now();
    if (input.value.trim() === '') {
      // Clear just this student's value for this field.
      db.delete(studentFieldValues)
        .where(and(eq(studentFieldValues.studentId, input.studentId), eq(studentFieldValues.defId, input.defId)))
        .run();
      audit(auditActor(ctx), 'fieldValue.clear', { entity: 'student', entityId: input.studentId, detail: { defId: input.defId } });
      return { ok: true as const };
    }
    const value = validateValue(def, input.value);
    db.insert(studentFieldValues)
      .values({ id: rid('fv'), studentId: input.studentId, defId: input.defId, value, createdAt: ts, updatedAt: ts })
      .onConflictDoUpdate({ target: [studentFieldValues.studentId, studentFieldValues.defId], set: { value, updatedAt: ts } })
      .run();
    audit(auditActor(ctx), 'fieldValue.set', { entity: 'student', entityId: input.studentId, detail: { defId: input.defId } });
    return { ok: true as const };
  }),

  // ── Staff notes (admin only for now — never finance/parent) ────────────────
  notesForStudent: adminProcedure.input(z.object({ studentId: ID })).query(({ input }) => {
    requireStudent(input.studentId);
    return db.select().from(studentNotes).where(eq(studentNotes.studentId, input.studentId)).orderBy(asc(studentNotes.createdAt)).all();
  }),

  noteAdd: adminProcedure.input(z.object({ studentId: ID, body: z.string().trim().min(1).max(4000) })).mutation(({ ctx, input }) => {
    requireStudent(input.studentId);
    const a = auditActor(ctx);
    const id = rid('note');
    db.insert(studentNotes).values({ id, studentId: input.studentId, body: input.body, authorUserId: a.userId, authorName: a.name, createdAt: now() }).run();
    audit(a, 'note.add', { entity: 'student', entityId: input.studentId }); // body never in the audit detail
    return { id };
  }),

  // ── Incidents (admin only for now — finance NEVER; parent-visibility opt-in) ─
  incidentsForStudent: adminProcedure.input(z.object({ studentId: ID })).query(({ input }) => {
    requireStudent(input.studentId);
    return db.select().from(incidents).where(eq(incidents.studentId, input.studentId)).orderBy(asc(incidents.date)).all();
  }),

  incidentAdd: adminProcedure
    .input(
      z.object({
        studentId: ID,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        category: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(4000),
        actionTaken: z.string().trim().max(4000).optional(),
        visibleToParents: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireStudent(input.studentId);
      const a = auditActor(ctx);
      const id = rid('inc');
      const ts = now();
      db.insert(incidents)
        .values({
          id,
          studentId: input.studentId,
          date: input.date,
          category: input.category,
          description: input.description,
          actionTaken: input.actionTaken?.trim() || null,
          visibleToParents: input.visibleToParents ?? false, // default OFF (§4/§14)
          recordedByUserId: a.userId,
          recordedByName: a.name,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      audit(a, 'incident.add', { entity: 'student', entityId: input.studentId, detail: { category: input.category, visibleToParents: input.visibleToParents ?? false } });
      return { id };
    }),

  incidentSetVisibility: adminProcedure.input(z.object({ id: ID, visibleToParents: z.boolean() })).mutation(({ ctx, input }) => {
    const inc = db.select({ id: incidents.id, studentId: incidents.studentId }).from(incidents).where(eq(incidents.id, input.id)).get();
    if (!inc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found.' });
    db.update(incidents).set({ visibleToParents: input.visibleToParents, updatedAt: now() }).where(eq(incidents.id, input.id)).run();
    audit(auditActor(ctx), 'incident.setVisibility', { entity: 'incident', entityId: input.id, detail: { visibleToParents: input.visibleToParents } });
    return { ok: true as const };
  }),
});
