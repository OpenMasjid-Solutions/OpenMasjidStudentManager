// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Exam score entry for a class: pick an assigned exam, fill a students × subjects grid (a
 *  mark, or "a"=absent / "e"=exempt; empty = not entered), and add a per-student term remark.
 *  A progress bar shows how much of the class is done. Per-cell autosave. Shared by the teacher
 *  and admin class windows; the server scopes access to the caller's classes. RTL-safe. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../lib/trpc';

type Status = 'scored' | 'absent' | 'exempt';

/** Parse a cell's raw text → an action for setScore. Returns null for "ignore/unchanged-invalid". */
function parseCell(raw: string): { status: 'scored' | 'absent' | 'exempt' | 'clear'; value?: number } | null {
  const s = raw.trim().toLowerCase();
  if (s === '') return { status: 'clear' };
  if (s === 'a' || s === 'abs' || s === 'absent') return { status: 'absent' };
  if (s === 'e' || s === 'exc' || s === 'exempt') return { status: 'exempt' };
  const n = Number(s);
  if (Number.isNaN(n) || n < 0) return null;
  return { status: 'scored', value: Math.round(n) };
}

function cellText(cell: { status: Status; value: number | null } | undefined, t: (k: string) => string): string {
  if (!cell) return '';
  if (cell.status === 'scored') return String(cell.value ?? '');
  return cell.status === 'absent' ? t('exams.absShort') : t('exams.excShort');
}

export function ExamsPanel({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const examsQ = trpc.exams.classExams.useQuery({ classId });
  const [examId, setExamId] = useState<string | null>(null);
  const activeExam = examId ?? examsQ.data?.[0]?.examId ?? null;
  const gridQ = trpc.exams.grid.useQuery({ examId: activeExam!, classId }, { enabled: !!activeExam });
  const setScore = trpc.exams.setScore.useMutation();
  const setRemark = trpc.exams.setRemark.useMutation();
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => utils.exams.grid.invalidate({ examId: activeExam!, classId });

  async function saveCell(studentId: string, subjectId: string, raw: string, maxMarks: number, current: string) {
    if (raw.trim() === current.trim()) return;
    const parsed = parseCell(raw);
    if (!parsed) { await refresh(); return; }
    if (parsed.status === 'scored' && parsed.value !== undefined && parsed.value > maxMarks) {
      setErr(t('exams.overMax', { max: maxMarks }));
      await refresh();
      return;
    }
    try {
      await setScore.mutateAsync({ examId: activeExam!, classId, studentId, subjectId, status: parsed.status, value: parsed.status === 'scored' ? parsed.value : undefined });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t('exams.saveFailed'));
    }
    await refresh();
  }

  async function saveRemark(studentId: string, raw: string, current: string) {
    if (raw.trim() === current.trim()) return;
    await setRemark.mutateAsync({ classId, studentId, remark: raw.trim() });
    await utils.exams.grid.invalidate({ examId: activeExam!, classId });
  }

  if (examsQ.isLoading) return <section className="section glass" style={{ padding: '1rem 1.1rem' }}><div className="section-head"><h2>{t('exams.title')}</h2></div><p className="empty">{t('common.loading')}</p></section>;
  const list = examsQ.data ?? [];

  return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head"><h2>{t('exams.title')}</h2></div>

      {list.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem' }}>{t('exams.noneAssigned')}</p>
      ) : (
        <>
          <div className="chip-row" style={{ marginBlockEnd: '0.75rem' }}>
            {list.map((e) => (
              <button key={e.examId} type="button" className={`chip ${e.examId === activeExam ? 'is-accent' : ''}`} onClick={() => setExamId(e.examId)}>{e.name}</button>
            ))}
          </div>

          {gridQ.data && (
            <>
              {/* Progress */}
              <div className="exam-progress" aria-label={t('exams.progress')}>
                <div className="exam-progress-bar"><span style={{ inlineSize: `${gridQ.data.progress.total ? Math.round((gridQ.data.progress.entered / gridQ.data.progress.total) * 100) : 0}%` }} /></div>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{t('exams.entered', { n: gridQ.data.progress.entered, total: gridQ.data.progress.total })}</span>
              </div>
              <p className="hint" style={{ marginBlockStart: '0.3rem' }}>{t('exams.cellHint')}</p>

              {err && <div className="notice notice--warn" style={{ marginBlockStart: '0.5rem', display: 'flex', gap: '0.5rem' }}><span style={{ flex: 1 }}>{err}</span><button type="button" className="link-btn" onClick={() => setErr(null)}>{t('common.close')}</button></div>}

              {gridQ.data.students.length === 0 ? (
                <p className="muted" style={{ fontSize: '0.9rem', marginBlockStart: '0.6rem' }}>{t('classes.noRoster')}</p>
              ) : (
                <div style={{ overflowX: 'auto', marginBlockStart: '0.6rem' }}>
                  <table className="data-table gradebook-table">
                    <thead>
                      <tr>
                        <th>{t('exams.student')}</th>
                        {gridQ.data.subjects.map((s) => <th key={s.id} className="gradebook-col"><span className="gradebook-col-title" title={s.name}>{s.name}</span><span className="muted gradebook-col-sub">/ {s.maxMarks}</span></th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {gridQ.data.students.map((r) => (
                        <tr key={r.studentId}>
                          <td>{r.firstName} {r.lastName}</td>
                          {gridQ.data!.subjects.map((s) => {
                            const cur = cellText(gridQ.data!.scores[`${r.studentId}|${s.id}`], t);
                            return (
                              <td key={s.id} className="gradebook-cell">
                                <input className="input glass-inset grade-input" defaultValue={cur} key={`${r.studentId}|${s.id}|${cur}`} onBlur={(e) => saveCell(r.studentId, s.id, e.target.value, s.maxMarks, cur)} aria-label={`${r.firstName} — ${s.name}`} />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Term remarks */}
              {gridQ.data.students.length > 0 && (
                <>
                  <div className="section-head" style={{ marginBlockStart: '1rem' }}><h2 style={{ fontSize: '0.95rem' }}>{t('exams.remarks')}</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {gridQ.data.students.map((r) => {
                      const cur = gridQ.data!.remarks[r.studentId] ?? '';
                      return (
                        <div key={r.studentId} className="exam-remark-row">
                          <span className="merit-name" style={{ flex: '0 1 9rem' }}>{r.firstName} {r.lastName}</span>
                          <input className="input glass-inset" style={{ flex: 1 }} defaultValue={cur} key={`rmk|${r.studentId}|${cur}`} placeholder={t('exams.remarkPlaceholder')} onBlur={(e) => saveRemark(r.studentId, e.target.value, cur)} />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
