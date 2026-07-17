// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The report-card PDF template (CLAUDE.md §15 — the artifact families keep). Built with
 * @react-pdf via React.createElement (no JSX, so the CJS server needs no build changes). A
 * dignified header, a clean marks table (subjects × the term's exams + a total), the overall
 * percentage + scale band, an attendance summary, an optional merit line, and the teacher's
 * remark. Neutral ink so it reads well printed black-and-white on a masjid photocopier. The
 * @react-pdf module + an Amiri-registered font are passed in by the generator.
 */
import { createElement as h, type ComponentType } from 'react';
import type { ReportCardData } from './aggregate';

type Pdf = typeof import('@react-pdf/renderer');
// @react-pdf overloads its primitives for both normal + SVG contexts, which confuses
// React.createElement's type inference. Cast to a permissive component type — the runtime
// components are unchanged; this only relaxes the compile-time prop typing.
type Comp = ComponentType<Record<string, unknown>>;

function styles(pdf: Pdf) {
  return pdf.StyleSheet.create({
    page: { padding: 36, fontFamily: 'Amiri', fontSize: 10, color: '#1a1a1a' },
    header: { borderBottomWidth: 2, borderBottomColor: '#0f766e', paddingBottom: 8, marginBottom: 14 },
    school: { fontSize: 18, fontWeight: 700, color: '#0f766e' },
    sub: { fontSize: 11, marginTop: 2, color: '#444' },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    meta: { fontSize: 10 },
    name: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
    table: { borderWidth: 1, borderColor: '#999', marginTop: 6 },
    tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc' },
    trHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#999', backgroundColor: '#f0f0f0' },
    th: { padding: 5, fontSize: 9, fontWeight: 700, borderRightWidth: 1, borderRightColor: '#ccc' },
    td: { padding: 5, fontSize: 10, borderRightWidth: 1, borderRightColor: '#eee' },
    cSubject: { flex: 3, textAlign: 'left' },
    cExam: { flex: 1, textAlign: 'center' },
    cTotal: { flex: 1, textAlign: 'center', fontWeight: 700 },
    overall: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, padding: 8, borderWidth: 1, borderColor: '#0f766e', backgroundColor: '#f0faf8' },
    overallLabel: { fontSize: 11, fontWeight: 700 },
    overallVal: { fontSize: 12, fontWeight: 700, color: '#0f766e' },
    section: { marginTop: 12 },
    sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 4, color: '#0f766e' },
    summaryRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
    chip: { fontSize: 9, padding: '2 6', borderWidth: 1, borderColor: '#ccc', borderRadius: 3 },
    remarkBox: { marginTop: 6, padding: 8, borderWidth: 1, borderColor: '#ccc', minHeight: 36, fontSize: 10 },
    footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#888', textAlign: 'center', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6 },
  });
}

/** One student's report-card page content (used standalone and inside a combined class doc). */
export function reportCardPage(pdf: Pdf, s: ReturnType<typeof styles>, d: ReportCardData, pageKey?: string | number) {
  const Page = pdf.Page as unknown as Comp;
  const View = pdf.View as unknown as Comp;
  const Text = pdf.Text as unknown as Comp;
  const cell = (style: object, text: string, key?: string | number) => h(Text, { style, key }, text);

  const headRow = h(View, { style: s.trHead, key: 'head' }, [
    cell([s.th, s.cSubject], 'Subject', 'h-sub'),
    ...d.exams.map((e, i) => cell([s.th, s.cExam], e.name, `h-${i}`)),
    cell([s.th, s.cTotal, { borderRightWidth: 0 }], 'Total', 'h-tot'),
  ]);

  const bodyRows = d.rows.length
    ? d.rows.map((r, ri) =>
        h(View, { style: s.tr, key: `r-${ri}` }, [
          cell([s.td, s.cSubject], r.subject, 'sub'),
          ...r.cells.map((c, ci) => cell([s.td, s.cExam], c.display, `c-${ci}`)),
          cell([s.td, s.cTotal, { borderRightWidth: 0 }], r.max > 0 ? `${r.obtained}/${r.max}` : '—', 'tot'),
        ]),
      )
    : [h(View, { style: s.tr, key: 'empty' }, cell([s.td, { flex: 1 }], 'No exam marks recorded for this term.', 'e'))];

  const attendance = `${d.attendance.present} present · ${d.attendance.late} late · ${d.attendance.absent} absent · ${d.attendance.excused} excused`;

  return h(Page, { size: 'A4', style: s.page, key: pageKey }, [
    h(View, { style: s.header, key: 'hd' }, [
      h(Text, { style: s.school, key: 'sc' }, d.school),
      h(Text, { style: s.sub, key: 'sb' }, `Report Card — ${d.term}`),
      h(View, { style: s.metaRow, key: 'mr' }, [
        h(View, { key: 'ml' }, [h(Text, { style: s.name, key: 'nm' }, d.studentName), h(Text, { style: s.meta, key: 'cl' }, `${d.className} · ${d.classType}`)]),
        h(Text, { style: s.meta, key: 'ver' }, `v${d.version}`),
      ]),
    ]),

    h(View, { style: s.table, key: 'tbl' }, [headRow, ...bodyRows]),

    h(View, { style: s.overall, key: 'ov' }, [
      h(Text, { style: s.overallLabel, key: 'ol' }, 'Overall'),
      h(Text, { style: s.overallVal, key: 'ovv' }, d.overall.percent !== null ? `${d.overall.obtained}/${d.overall.max}  ·  ${d.overall.percent}%${d.overall.band ? `  ·  ${d.overall.band}` : ''}` : '—'),
    ]),

    h(View, { style: s.section, key: 'att' }, [
      h(Text, { style: s.sectionTitle, key: 'at' }, 'Attendance'),
      h(Text, { style: { fontSize: 10 }, key: 'av' }, d.attendance.total > 0 ? attendance : 'No attendance recorded.'),
    ]),

    ...(d.meritTotal !== null
      ? [h(View, { style: s.section, key: 'mt' }, [h(Text, { style: s.sectionTitle, key: 'mtt' }, 'Merit points'), h(Text, { style: { fontSize: 10 }, key: 'mtv' }, d.meritTotal > 0 ? `+${d.meritTotal}` : String(d.meritTotal))])]
      : []),

    h(View, { style: s.section, key: 'rk' }, [
      h(Text, { style: s.sectionTitle, key: 'rt' }, 'Teacher’s remark'),
      h(View, { style: s.remarkBox, key: 'rb' }, h(Text, {}, d.remark || '')),
    ]),

    h(Text, { style: s.footer, key: 'ft', fixed: true }, `${d.school} · Generated ${new Date(d.generatedAt).toISOString().slice(0, 10)} · Version ${d.version}`),
  ]);
}

export function reportCardDocument(pdf: Pdf, d: ReportCardData) {
  const s = styles(pdf);
  const Document = pdf.Document as unknown as Comp;
  return h(Document, { title: `Report Card — ${d.studentName}` }, reportCardPage(pdf, s, d));
}

/** One combined document, a page per student (no merge lib — §7). A Document needs ≥1 Page, so
 *  an empty class renders a single placeholder page. */
export function combinedDocument(pdf: Pdf, list: ReportCardData[]) {
  const s = styles(pdf);
  const Document = pdf.Document as unknown as Comp;
  const Page = pdf.Page as unknown as Comp;
  const Text = pdf.Text as unknown as Comp;
  if (list.length === 0) {
    return h(Document, { title: 'Report Cards' }, h(Page, { size: 'A4', style: s.page, key: 'empty' }, h(Text, {}, 'No report cards have been generated yet.')));
  }
  return h(Document, { title: 'Report Cards' }, list.map((d, i) => reportCardPage(pdf, s, d, `pg-${i}`)));
}
