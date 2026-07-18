// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report-card generation (CLAUDE.md §4/§9/§14): render the @react-pdf template to a PDF, store
 * it under /data/reports with a randomized name, and insert an immutable, versioned
 * report_cards row (version N+1 each regeneration — never edited/deleted). @react-pdf is ESM,
 * so it's loaded via dynamic import; the Amiri font (Latin + Arabic) is registered once.
 *
 * Concurrency: the version is reserved inside a synchronous better-sqlite3 transaction (no
 * await inside → no interleave), and a UNIQUE(student,class,version) index backs it up — so two
 * overlapping regenerations can never write the same version. The rendered ReportCardData is
 * snapshotted on the row so the combined class PDF reproduces the filed versions exactly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, asc, desc } from 'drizzle-orm';
import { db } from '../db';
import { reportCards, enrollments, students, classes } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { getPdf as pdf, reportsDir, reportFilePath } from './pdf';
import { buildReportCard, type ReportCardData } from './aggregate';
import { reportCardDocument, combinedDocument } from './template';

type Actor = { userId: string | null; role: string; name: string | null };

/** Generate + store one student's report card as a new immutable version. */
export async function generateStudentCard(studentId: string, classId: string, actor: Actor): Promise<{ id: string; version: number }> {
  const enrolled = db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'))).get();
  if (!enrolled) throw new Error('student not enrolled');
  const cls = db.select({ termId: classes.termId }).from(classes).where(eq(classes.id, classId)).get();
  if (!cls) throw new Error('class not found');

  const generatedAt = new Date();
  const id = rid('rcd');
  const filename = `${rid('rc')}.pdf`; // deterministic name, reserved before the async render

  // Reserve the next version atomically. better-sqlite3 runs the callback fully synchronously,
  // so no other request can read the same max and insert the same version; the UNIQUE index is
  // the belt-and-suspenders backstop.
  const version = db.transaction((tx) => {
    const prev = tx.select({ version: reportCards.version }).from(reportCards).where(and(eq(reportCards.studentId, studentId), eq(reportCards.classId, classId))).all();
    const v = prev.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    tx.insert(reportCards).values({ id, studentId, classId, termId: cls.termId, version: v, pdfPath: filename, dataJson: null, generatedByUserId: actor.userId, generatedByName: actor.name, generatedAt, createdAt: generatedAt, updatedAt: generatedAt }).run();
    return v;
  });

  try {
    const data = buildReportCard(studentId, classId, { generatedAt, version });
    const p = await pdf();
    const buf = await p.renderToBuffer(reportCardDocument(p, data));
    fs.writeFileSync(path.join(reportsDir(), filename), buf);
    db.update(reportCards).set({ dataJson: data as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(reportCards.id, id)).run();
  } catch (e) {
    // Roll back the reserved row so a failed render doesn't leave a fileless version.
    db.delete(reportCards).where(eq(reportCards.id, id)).run();
    throw e;
  }
  audit(actor, 'reportcard.generate', { entity: 'class', entityId: classId, detail: { version } });
  return { id, version };
}

/** Generate a fresh card for every active student in the class. */
export async function generateClassCards(classId: string, actor: Actor): Promise<{ count: number }> {
  const roster = db.select({ studentId: enrollments.studentId }).from(enrollments).where(and(eq(enrollments.classId, classId), eq(enrollments.status, 'active'))).orderBy(asc(enrollments.createdAt)).all();
  let count = 0;
  for (const r of roster) {
    await generateStudentCard(r.studentId, classId, actor);
    count++;
  }
  return { count };
}

/** Render (not store) one combined PDF for the whole class — a page per student, from the FILED
 *  snapshots (never live data), so it matches the individual versioned cards exactly. Students
 *  with no generated card are skipped. */
export async function renderClassCombined(classId: string): Promise<Buffer> {
  const p = await pdf();
  const roster = db
    .select({ studentId: enrollments.studentId })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.classId, classId), eq(enrollments.status, 'active')))
    .orderBy(asc(students.firstName))
    .all();
  const list: ReportCardData[] = [];
  for (const r of roster) {
    const latest = db.select({ dataJson: reportCards.dataJson }).from(reportCards).where(and(eq(reportCards.studentId, r.studentId), eq(reportCards.classId, classId))).orderBy(desc(reportCards.version)).limit(1).get();
    if (latest?.dataJson) list.push(latest.dataJson as unknown as ReportCardData);
  }
  return p.renderToBuffer(combinedDocument(p, list));
}

/** Re-exported for the authed serving route (kept here for import stability). */
export { reportFilePath as reportCardFilePath };
