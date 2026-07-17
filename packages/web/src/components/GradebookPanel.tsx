// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The class gradebook: assignments (columns) × students (rows), a score in each cell, plus a
 *  per-student overall % and its scale band. Per-cell save (spreadsheet-style). Shared by the
 *  teacher and admin class windows; the admin also gets a scale selector. RTL-safe; the grid
 *  scrolls horizontally inside its own container so the window never scrolls sideways. */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Plus } from 'lucide-react';
import { trpc } from '../lib/trpc';

export function GradebookPanel({ classId, canConfigScale = false }: { classId: string; canConfigScale?: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const q = trpc.grades.grid.useQuery({ classId });
  const scalesQ = trpc.grades.scaleList.useQuery(undefined, { enabled: canConfigScale });
  const itemCreate = trpc.grades.itemCreate.useMutation();
  const itemDelete = trpc.grades.itemDelete.useMutation();
  const setScores = trpc.grades.setScores.useMutation();
  const setScale = trpc.grades.setClassScale.useMutation();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [maxPoints, setMaxPoints] = useState('10');
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () => utils.grades.grid.invalidate({ classId });

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const mp = parseInt(maxPoints, 10);
    if (!title.trim() || !mp || mp < 1) return;
    await itemCreate.mutateAsync({ classId, title: title.trim(), maxPoints: mp });
    setTitle('');
    setMaxPoints('10');
    setAdding(false);
    await refresh();
  }

  async function saveCell(itemId: string, studentId: string, raw: string, original: number | undefined, max: number) {
    const trimmed = raw.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      await refresh();
      return;
    }
    if (value === (original ?? null)) return; // unchanged
    // Instant client-side guard for the common over-max case (avoids a round-trip).
    if (value !== null && value > max) {
      setSaveError(t('gradebook.overMax', { max }));
      await refresh(); // revert the cell to its last good value
      return;
    }
    try {
      await setScores.mutateAsync({ classId, gradeItemId: itemId, entries: [{ studentId, points: value }] });
      setSaveError(null);
    } catch (err) {
      // Surface the server's friendly message instead of silently dropping it (§15).
      setSaveError(err instanceof Error && err.message ? err.message : t('gradebook.saveFailed'));
    }
    await refresh();
  }

  if (q.isError) return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head"><h2>{t('gradebook.title')}</h2></div>
      <p className="empty">{t('gradebook.loadError')}</p>
      <div style={{ textAlign: 'center' }}><button type="button" className="btn btn--ghost btn--sm" onClick={() => q.refetch()}>{t('gradebook.retry')}</button></div>
    </section>
  );
  if (q.isLoading || !q.data) return <section className="section glass" style={{ padding: '1rem 1.1rem' }}><div className="section-head"><h2>{t('gradebook.title')}</h2></div><p className="empty">{t('common.loading')}</p></section>;
  const { items, students, scale } = q.data;

  return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head">
        <h2>{t('gradebook.title')}</h2>
        <span className="spacer" style={{ flex: 1 }} />
        {canConfigScale ? (
          <label className="gradebook-scale">
            <span className="muted" style={{ fontSize: '0.8rem' }}>{t('gradebook.scale')}</span>
            <select className="input glass-inset" style={{ width: 'auto', paddingBlock: '0.3rem' }} value={scale?.id ?? ''} onChange={async (e) => { await setScale.mutateAsync({ classId, scaleId: e.target.value || null }); await refresh(); }}>
              <option value="">{t('gradebook.noScale')}</option>
              {(scalesQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        ) : (
          scale && <span className="chip is-muted">{scale.name}</span>
        )}
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding((v) => !v)}><Plus size={15} /> {t('gradebook.addItem')}</button>
      </div>

      {adding && (
        <form className="inline-form glass-inset" onSubmit={addItem} style={{ marginBlockStart: 0 }}>
          <div className="field" style={{ flex: '2 1 12rem' }}><label className="label">{t('gradebook.itemTitle')}</label><input className="input glass-inset" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></div>
          <div className="field" style={{ flex: '0 1 7rem' }}><label className="label">{t('gradebook.maxPoints')}</label><input type="number" min="1" className="input glass-inset" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} /></div>
          <button type="submit" className="btn btn--primary" disabled={itemCreate.isPending}>{t('common.save')}</button>
        </form>
      )}

      {saveError && (
        <div className="notice notice--warn" style={{ marginBlockStart: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ flex: 1 }}>{saveError}</span>
          <button type="button" className="link-btn" onClick={() => setSaveError(null)}>{t('common.close')}</button>
        </div>
      )}

      {students.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem', marginBlockStart: '0.6rem' }}>{t('classes.noRoster')}</p>
      ) : items.length === 0 ? (
        <p className="empty">{t('gradebook.noItems')}</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBlockStart: '0.6rem' }}>
          <table className="data-table gradebook-table">
            <thead>
              <tr>
                <th>{t('gradebook.student')}</th>
                {items.map((it) => (
                  <th key={it.id} className="gradebook-col">
                    <div className="gradebook-col-head">
                      <span className="gradebook-col-title" title={it.title}>{it.title}</span>
                      <button type="button" className="link-btn gradebook-del" aria-label={t('common.delete')} onClick={async () => { if (!window.confirm(t('gradebook.confirmDelete', { title: it.title }))) return; await itemDelete.mutateAsync({ id: it.id }); await refresh(); }}><Trash2 size={12} /></button>
                    </div>
                    <span className="muted gradebook-col-sub">/ {it.maxPoints}{it.avgPercent !== null && ` · ${t('gradebook.avg')} ${it.avgPercent}%`}</span>
                  </th>
                ))}
                <th>{t('gradebook.overall')}</th>
                {scale && <th>{scale.name}</th>}
              </tr>
            </thead>
            <tbody>
              {students.map((r) => (
                <tr key={r.studentId}>
                  <td>{r.firstName} {r.lastName}</td>
                  {items.map((it) => (
                    <td key={it.id} className="gradebook-cell">
                      <input
                        type="number"
                        min="0"
                        max={it.maxPoints}
                        step="0.5"
                        className="input glass-inset grade-input"
                        defaultValue={r.scores[it.id] ?? ''}
                        key={`${it.id}|${r.studentId}|${r.scores[it.id] ?? ''}`}
                        onBlur={(e) => saveCell(it.id, r.studentId, e.target.value, r.scores[it.id], it.maxPoints)}
                        aria-label={`${r.firstName} — ${it.title}`}
                      />
                    </td>
                  ))}
                  <td className="gradebook-total">{r.percent !== null ? `${r.percent}%` : '—'}</td>
                  {scale && <td>{r.band ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
