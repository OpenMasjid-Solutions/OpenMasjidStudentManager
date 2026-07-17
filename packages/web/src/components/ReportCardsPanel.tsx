// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Report cards for a class: admin generates (per student or the whole class), publishes to
 *  parents, and downloads; the assigned teacher can view + download any version (read-only).
 *  PDFs open via the authed /reports routes (the browser sends the session cookie). RTL-safe. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Download, RefreshCw } from 'lucide-react';
import { trpc } from '../lib/trpc';

export function ReportCardsPanel({ classId, canGenerate = false }: { classId: string; canGenerate?: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const q = trpc.reports.list.useQuery({ classId });
  const genClass = trpc.reports.generateClass.useMutation();
  const genStudent = trpc.reports.generateStudent.useMutation();
  const publish = trpc.reports.publishClass.useMutation();
  const [busy, setBusy] = useState(false);

  const refresh = () => utils.reports.list.invalidate({ classId });
  const rows = q.data ?? [];
  const anyPublished = rows.some((r) => r.latest?.publishedAt);
  const anyCards = rows.some((r) => r.latest);
  const fmtDate = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

  async function generateAll() {
    setBusy(true);
    try { await genClass.mutateAsync({ classId }); await refresh(); } finally { setBusy(false); }
  }
  async function regen(studentId: string) {
    await genStudent.mutateAsync({ classId, studentId });
    await refresh();
  }
  async function togglePublish() {
    await publish.mutateAsync({ classId, published: !anyPublished });
    await refresh();
  }

  return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head">
        <h2>{t('reports.title')}</h2>
        <span className="spacer" style={{ flex: 1 }} />
        {canGenerate && <button type="button" className="btn btn--primary btn--sm" onClick={generateAll} disabled={busy || genClass.isPending}><FileText size={15} /> {busy ? t('reports.generating') : t('reports.generateAll')}</button>}
        {canGenerate && anyCards && <button type="button" className="btn btn--ghost btn--sm" onClick={togglePublish} disabled={publish.isPending}>{anyPublished ? t('reports.unpublishAll') : t('reports.publishAll')}</button>}
        {anyCards && <a className="btn btn--ghost btn--sm" href={`/reports/class/${classId}/combined`} target="_blank" rel="noopener noreferrer"><Download size={15} /> {t('reports.downloadAll')}</a>}
      </div>

      {q.isLoading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem' }}>{t('classes.noRoster')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>{t('reports.student')}</th><th>{t('reports.version')}</th><th>{t('reports.generated')}</th><th>{t('reports.status')}</th><th className="actions" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td>{r.firstName} {r.lastName}</td>
                  <td>{r.latest ? `v${r.latest.version}` : '—'}</td>
                  <td>{r.latest ? fmtDate(r.latest.generatedAt) : '—'}</td>
                  <td>{r.latest ? (r.latest.publishedAt ? <span className="chip is-accent">{t('reports.published')}</span> : <span className="chip is-muted">{t('reports.unpublished')}</span>) : '—'}</td>
                  <td className="actions">
                    {r.latest && <a className="btn btn--ghost btn--sm" href={`/reports/card/${r.latest.id}`} target="_blank" rel="noopener noreferrer" aria-label={t('reports.download')}><Download size={14} /></a>}
                    {canGenerate && <button type="button" className="btn btn--ghost btn--sm" onClick={() => regen(r.studentId)} disabled={genStudent.isPending} aria-label={r.latest ? t('reports.regenerate') : t('reports.generate')}><RefreshCw size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canGenerate && <p className="hint" style={{ marginBlockStart: '0.5rem' }}>{t('reports.hint')}</p>}
    </section>
  );
}
