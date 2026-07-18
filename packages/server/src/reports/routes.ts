// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Authed serving of report-card PDFs (CLAUDE.md §14 — minors' academic records). Every fetch
 * re-checks the role × origin matrix: admin (LAN only) and the assigned teacher may fetch any
 * version; finance never; parents (own kids, published only) arrive with the portal. Files live
 * under /data/reports with randomized names and are NEVER on a public static mount — they reach
 * a client only through these routes.
 */
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { reportCards, transcripts, classTeachers } from '../db/schema';
import { getSession, COOKIE } from '../auth/sessions';
import { classifyOrigin, roleAllowedFromOrigin } from '../security/origin';
import { renderClassCombined } from './generate';
import { reportFilePath } from './pdf';

/** Can the current request read report cards for this class? admin (LAN) or the assigned teacher. */
function canAccessClass(req: FastifyRequest, classId: string): boolean {
  const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.[COOKIE];
  const session = getSession(token);
  if (!session) return false;
  if (!roleAllowedFromOrigin(session.role, classifyOrigin(req))) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'teacher' && session.userId) {
    return !!db.select({ classId: classTeachers.classId }).from(classTeachers).where(and(eq(classTeachers.classId, classId), eq(classTeachers.userId, session.userId))).get();
  }
  return false; // finance never; parent (own kids, published) lands with the portal
}

/** Transcripts are cumulative across classes, so (for now) only admin (LAN) may fetch them.
 *  Parent access (own kids, published) arrives with the portal. */
function canAccessTranscript(req: FastifyRequest): boolean {
  const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.[COOKIE];
  const session = getSession(token);
  if (!session) return false;
  if (!roleAllowedFromOrigin(session.role, classifyOrigin(req))) return false;
  return session.role === 'admin';
}

export function registerReportRoutes(app: FastifyInstance): void {
  // One stored, versioned report card.
  app.get('/reports/card/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const card = db.select({ id: reportCards.id, classId: reportCards.classId, version: reportCards.version, pdfPath: reportCards.pdfPath }).from(reportCards).where(eq(reportCards.id, req.params.id)).get();
    if (!card) return reply.code(404).send({ error: 'Not found.' });
    if (!canAccessClass(req, card.classId)) return reply.code(403).send({ error: 'You don’t have access to that.' });
    const file = reportFilePath(card.pdfPath);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'Not found.' });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="report-card-v${card.version}.pdf"`).send(fs.readFileSync(file));
  });

  // One stored, versioned transcript (admin only for now).
  app.get('/reports/transcript/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tr = db.select({ id: transcripts.id, version: transcripts.version, pdfPath: transcripts.pdfPath }).from(transcripts).where(eq(transcripts.id, req.params.id)).get();
    if (!tr) return reply.code(404).send({ error: 'Not found.' });
    if (!canAccessTranscript(req)) return reply.code(403).send({ error: 'You don’t have access to that.' });
    const file = reportFilePath(tr.pdfPath);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'Not found.' });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="transcript-v${tr.version}.pdf"`).send(fs.readFileSync(file));
  });

  // A freshly-rendered combined PDF for the whole class (a page per active student).
  app.get('/reports/class/:classId/combined', async (req: FastifyRequest<{ Params: { classId: string } }>, reply: FastifyReply) => {
    if (!canAccessClass(req, req.params.classId)) return reply.code(403).send({ error: 'You don’t have access to that.' });
    const buf = await renderClassCombined(req.params.classId);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'inline; filename="report-cards.pdf"').send(buf);
  });
}
