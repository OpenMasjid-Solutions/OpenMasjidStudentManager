// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Transcripts (CLAUDE.md §4/§9) — the cumulative, multi-year record an ʿālim-course graduate
 * leaves with. Built ONLY from frozen `term_finals` (never live gradebooks): every term, every
 * class (with type), the frozen final grade + scale band. Rendered on the same @react-pdf
 * pipeline + immutable-versioning rules as report cards. No credit-hours/GPA in v1 (§4 ❌).
 */
import { createElement as h, type ComponentType } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { transcripts, termFinals, students, classes, terms } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { getPdf, reportsDir, type Pdf } from './pdf';
import { getSchoolName } from '../settings';

type Actor = { userId: string | null; role: string; name: string | null };
type Comp = ComponentType<Record<string, unknown>>;
const CLASS_TYPE_LABEL: Record<string, string> = { maktab: 'Maktab', hifz: 'Hifz', nazrah: 'Nazrah', alim: 'ʿĀlim course', custom: 'Class' };

export interface TranscriptData {
  school: string;
  studentName: string;
  generatedAt: Date;
  version: number;
  terms: { termName: string; rows: { className: string; classType: string; percent: number | null; band: string | null }[] }[];
}

export function buildTranscript(studentId: string, opts: { generatedAt: Date; version: number }): TranscriptData {
  const student = db.select().from(students).where(eq(students.id, studentId)).get();
  if (!student) throw new Error('student not found');
  const finals = db
    .select({
      termId: termFinals.termId,
      termName: terms.name,
      termStartDate: terms.startDate,
      termCreatedAt: terms.createdAt,
      className: classes.name,
      classType: classes.type,
      customLabel: classes.customLabel,
      percentTenths: termFinals.percentTenths,
      band: termFinals.band,
    })
    .from(termFinals)
    .innerJoin(terms, eq(terms.id, termFinals.termId))
    .innerJoin(classes, eq(classes.id, termFinals.classId))
    .where(eq(termFinals.studentId, studentId))
    .orderBy(asc(classes.name))
    .all();

  const byTerm = new Map<string, { termName: string; sortKey: string; rows: TranscriptData['terms'][number]['rows'] }>();
  for (const f of finals) {
    let g = byTerm.get(f.termId);
    if (!g) {
      // Chronological order: prefer the term's start date (correct even for backfilled historical
      // terms created out of order), falling back to when the term row was created.
      const sortKey = f.termStartDate || new Date(f.termCreatedAt).toISOString();
      g = { termName: f.termName, sortKey, rows: [] };
      byTerm.set(f.termId, g);
    }
    g.rows.push({
      className: f.className,
      classType: f.classType === 'custom' ? f.customLabel || 'Class' : CLASS_TYPE_LABEL[f.classType] ?? f.classType,
      percent: f.percentTenths !== null ? f.percentTenths / 10 : null,
      band: f.band,
    });
  }
  const orderedTerms = [...byTerm.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((g) => ({ termName: g.termName, rows: g.rows }));
  return { school: getSchoolName(), studentName: `${student.firstName} ${student.lastName}`, generatedAt: opts.generatedAt, version: opts.version, terms: orderedTerms };
}

function transcriptDocument(pdf: Pdf, d: TranscriptData) {
  const Document = pdf.Document as unknown as Comp;
  const Page = pdf.Page as unknown as Comp;
  const View = pdf.View as unknown as Comp;
  const Text = pdf.Text as unknown as Comp;
  const s = pdf.StyleSheet.create({
    page: { padding: 36, fontFamily: 'Amiri', fontSize: 10, color: '#1a1a1a' },
    header: { borderBottomWidth: 2, borderBottomColor: '#0f766e', paddingBottom: 8, marginBottom: 14 },
    school: { fontSize: 18, fontWeight: 700, color: '#0f766e' },
    sub: { fontSize: 11, marginTop: 2, color: '#444' },
    name: { fontSize: 14, fontWeight: 700, marginTop: 8 },
    term: { marginTop: 12 },
    termName: { fontSize: 11, fontWeight: 700, color: '#0f766e', marginBottom: 4 },
    table: { borderWidth: 1, borderColor: '#999' },
    trHead: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderBottomWidth: 1, borderBottomColor: '#999' },
    tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ddd' },
    th: { padding: 5, fontSize: 9, fontWeight: 700, borderRightWidth: 1, borderRightColor: '#ccc' },
    td: { padding: 5, fontSize: 10, borderRightWidth: 1, borderRightColor: '#eee' },
    cClass: { flex: 3 },
    cType: { flex: 2 },
    cFinal: { flex: 1, textAlign: 'center' },
    cBand: { flex: 2, textAlign: 'center' },
    footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#888', textAlign: 'center', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6 },
    empty: { fontSize: 10, color: '#666', marginTop: 12 },
  });
  const cell = (st: object, t: string, key?: string) => h(Text, { style: st, key }, t);

  const termSections = d.terms.length
    ? d.terms.map((tm, ti) =>
        h(View, { style: s.term, key: `t-${ti}` }, [
          h(Text, { style: s.termName, key: 'tn' }, tm.termName),
          h(View, { style: s.table, key: 'tb' }, [
            h(View, { style: s.trHead, key: 'h' }, [cell([s.th, s.cClass], 'Class', 'c'), cell([s.th, s.cType], 'Type', 'ty'), cell([s.th, s.cFinal], 'Final', 'f'), cell([s.th, s.cBand, { borderRightWidth: 0 }], 'Grade', 'b')]),
            ...tm.rows.map((r, ri) =>
              h(View, { style: s.tr, key: `r-${ri}` }, [
                cell([s.td, s.cClass], r.className, 'c'),
                cell([s.td, s.cType], r.classType, 'ty'),
                cell([s.td, s.cFinal], r.percent !== null ? `${r.percent}%` : '—', 'f'),
                cell([s.td, s.cBand, { borderRightWidth: 0 }], r.band ?? '—', 'b'),
              ]),
            ),
          ]),
        ]),
      )
    : [h(Text, { style: s.empty, key: 'none' }, 'No completed terms on record yet.')];

  return h(Document, { title: `Transcript — ${d.studentName}` },
    h(Page, { size: 'A4', style: s.page }, [
      h(View, { style: s.header, key: 'hd' }, [
        h(Text, { style: s.school, key: 'sc' }, d.school),
        h(Text, { style: s.sub, key: 'sb' }, 'Academic Transcript'),
        h(Text, { style: s.name, key: 'nm' }, d.studentName),
      ]),
      ...termSections,
      h(Text, { style: s.footer, key: 'ft', fixed: true }, `${d.school} · Generated ${new Date(d.generatedAt).toISOString().slice(0, 10)} · Version ${d.version}`),
    ]),
  );
}

/** Generate + store one student's transcript as a new immutable version. */
export async function generateTranscript(studentId: string, actor: Actor): Promise<{ id: string; version: number }> {
  if (!db.select({ id: students.id }).from(students).where(eq(students.id, studentId)).get()) throw new Error('student not found');
  const generatedAt = new Date();
  const id = rid('trs');
  const filename = `${rid('tr')}.pdf`;
  const version = db.transaction((tx) => {
    const prev = tx.select({ version: transcripts.version }).from(transcripts).where(eq(transcripts.studentId, studentId)).all();
    const v = prev.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    tx.insert(transcripts).values({ id, studentId, version: v, pdfPath: filename, dataJson: null, generatedByUserId: actor.userId, generatedByName: actor.name, generatedAt, createdAt: generatedAt, updatedAt: generatedAt }).run();
    return v;
  });
  try {
    const data = buildTranscript(studentId, { generatedAt, version });
    const p = await getPdf();
    const buf = await p.renderToBuffer(transcriptDocument(p, data));
    fs.writeFileSync(path.join(reportsDir(), filename), buf);
    db.update(transcripts).set({ dataJson: data as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(transcripts.id, id)).run();
  } catch (e) {
    db.delete(transcripts).where(eq(transcripts.id, id)).run();
    throw e;
  }
  audit(actor, 'transcript.generate', { entity: 'student', entityId: studentId, detail: { version } });
  return { id, version };
}
