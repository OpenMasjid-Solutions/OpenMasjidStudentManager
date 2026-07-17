// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Merit points for a class: award (or deduct) against admin-defined categories, a staff-side
 *  leaderboard of term totals, and recent awards (with an undo). Shared by the teacher and
 *  admin class windows; the server scopes access to the caller's classes. RTL-safe. */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, Trash2 } from 'lucide-react';
import { trpc } from '../lib/trpc';

export function MeritPanel({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const catsQ = trpc.merit.categoryList.useQuery();
  const sumQ = trpc.merit.classSummary.useQuery({ classId });
  const award = trpc.merit.award.useMutation();
  const del = trpc.merit.awardDelete.useMutation();

  const [studentId, setStudentId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');

  const refresh = () => utils.merit.classSummary.invalidate({ classId });

  function pickCategory(id: string) {
    setCategoryId(id);
    const c = (catsQ.data ?? []).find((x) => x.id === id);
    if (c) setPoints(String(c.defaultPoints));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pts = parseInt(points, 10);
    if (!studentId || !categoryId || Number.isNaN(pts)) return;
    await award.mutateAsync({ classId, studentId, categoryId, points: pts, note: note.trim() || undefined });
    setNote('');
    await refresh();
  }

  const students = sumQ.data?.students ?? [];
  const recent = sumQ.data?.recent ?? [];
  const cats = catsQ.data ?? [];
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

  return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head"><h2>{t('merit.title')}</h2></div>

      {/* Award form */}
      <form className="inline-form glass-inset" onSubmit={submit} style={{ marginBlockStart: 0 }}>
        <div className="field"><label className="label">{t('merit.student')}</label>
          <select className="input glass-inset" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">{t('merit.chooseStudent')}</option>
            {students.map((s) => <option key={s.studentId} value={s.studentId}>{s.firstName} {s.lastName}</option>)}
          </select>
        </div>
        <div className="field"><label className="label">{t('merit.category')}</label>
          <select className="input glass-inset" value={categoryId} onChange={(e) => pickCategory(e.target.value)}>
            <option value="">{t('merit.chooseCategory')}</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name} ({fmt(c.defaultPoints)})</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '0 1 6rem' }}><label className="label">{t('merit.points')}</label><input type="number" className="input glass-inset" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
        <div className="field" style={{ flex: '2 1 10rem' }}><label className="label">{t('merit.note')}</label><input className="input glass-inset" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('merit.notePlaceholder')} /></div>
        <button type="submit" className="btn btn--primary" disabled={!studentId || !categoryId || award.isPending}><Award size={15} /> {t('merit.award')}</button>
      </form>

      {/* Leaderboard */}
      <div className="section-head" style={{ marginBlockStart: '1rem' }}><h2 style={{ fontSize: '0.95rem' }}>{t('merit.leaderboard')}</h2></div>
      {students.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem' }}>{t('classes.noRoster')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {students.map((s, i) => (
            <div key={s.studentId} className="merit-row glass-inset">
              <span className="merit-rank">{i + 1}</span>
              <span className="merit-name">{s.firstName} {s.lastName}</span>
              <span className={`merit-total ${s.total >= 0 ? 'is-pos' : 'is-neg'}`}>{fmt(s.total)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent awards */}
      {recent.length > 0 && (
        <>
          <div className="section-head" style={{ marginBlockStart: '1rem' }}><h2 style={{ fontSize: '0.95rem' }}>{t('merit.recent')}</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {recent.map((a) => (
              <div key={a.id} className="merit-recent">
                <span className={`merit-total ${a.points >= 0 ? 'is-pos' : 'is-neg'}`} style={{ minInlineSize: '2.5rem' }}>{fmt(a.points)}</span>
                <span className="merit-name">{a.studentName}</span>
                <span className="chip is-muted">{a.categoryName}</span>
                {a.note && <span className="muted" style={{ fontSize: '0.82rem' }}>“{a.note}”</span>}
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="btn btn--ghost btn--sm" aria-label={t('common.delete')} onClick={async () => { await del.mutateAsync({ id: a.id }); await refresh(); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
