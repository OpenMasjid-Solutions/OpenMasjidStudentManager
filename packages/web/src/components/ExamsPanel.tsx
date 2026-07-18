// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Exam score entry for a class: pick an assigned exam, fill a students × subjects grid (a
 *  mark, or "a"=absent / "e"=exempt; empty = not entered), and add a per-student term remark.
 *  A progress bar shows how much of the class is done. Per-cell autosave. Shared by the teacher
 *  and admin class windows; the server scopes access to the caller's classes. RTL-safe. */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
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

export function ExamsPanel({ classId, canPersonal = false }: { classId: string; canPersonal?: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const examsQ = trpc.exams.classExams.useQuery({ classId });
  const [examId, setExamId] = useState<string | null>(null);
  const activeExam = examId ?? examsQ.data?.[0]?.examId ?? null;
  const gridQ = trpc.exams.grid.useQuery({ examId: activeExam!, classId }, { enabled: !!activeExam });
  const setScore = trpc.exams.setScore.useMutation();
  const setRemark = trpc.exams.setRemark.useMutation();
  const [err, setErr] = useState<string | null>(null);

  // Comment bank (shared + own personal) + controlled remark drafts so snippets can be inserted.
  const snippetsQ = trpc.comments.list.useQuery();
  const snipCreate = trpc.comments.create.useMutation();
  const snipRemove = trpc.comments.remove.useMutation();
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});
  const seededClass = useRef<string>('');
  // Which remark fields the user actually edited this session — so blurring an UNTOUCHED field
  // never re-saves a stale draft over a co-teacher's meanwhile-saved remark (last-write-wins).
  const remarkDirty = useRef<Set<string>>(new Set());
  const [manageSnips, setManageSnips] = useState(false);
  const [newSnip, setNewSnip] = useState('');

  useEffect(() => {
    if (!gridQ.data) return;
    if (seededClass.current === classId) return; // seed once per class; don't clobber edits on refetch
    const m: Record<string, string> = {};
    for (const r of gridQ.data.students) m[r.studentId] = gridQ.data.remarks[r.studentId] ?? '';
    setRemarkDraft(m);
    seededClass.current = classId;
  }, [gridQ.data, classId]);

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

  /** Save on blur only if the field was edited (guards against clobbering a co-teacher's remark). */
  async function blurRemark(studentId: string, value: string) {
    if (!remarkDirty.current.has(studentId)) return;
    await saveRemark(studentId, value, gridQ.data?.remarks[studentId] ?? '');
    remarkDirty.current.delete(studentId);
  }

  const allSnippets = [...(snippetsQ.data?.shared ?? []).map((s) => ({ ...s, kind: 'shared' as const })), ...(snippetsQ.data?.personal ?? []).map((s) => ({ ...s, kind: 'personal' as const }))];

  async function insertSnippet(studentId: string, text: string) {
    const existing = remarkDraft[studentId] ?? '';
    const next = existing.trim() ? `${existing.trim()} ${text}` : text;
    setRemarkDraft((d) => ({ ...d, [studentId]: next }));
    await saveRemark(studentId, next, existing);
  }
  async function addPersonalSnippet() {
    const text = newSnip.trim();
    if (!text) return;
    await snipCreate.mutateAsync({ scope: 'personal', text });
    setNewSnip('');
    await utils.comments.list.invalidate();
  }
  async function removeSnippet(id: string) {
    await snipRemove.mutateAsync({ id });
    await utils.comments.list.invalidate();
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

              {/* Term remarks (with comment-bank snippet insert) */}
              {gridQ.data.students.length > 0 && (
                <>
                  <div className="section-head" style={{ marginBlockStart: '1rem' }}>
                    <h2 style={{ fontSize: '0.95rem' }}>{t('exams.remarks')}</h2>
                    <span className="spacer" style={{ flex: 1 }} />
                    {canPersonal && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setManageSnips((v) => !v)}>{t('comments.mySnippets')}</button>}
                  </div>

                  {canPersonal && manageSnips && (
                    <div className="glass-inset" style={{ padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-button)', marginBlockEnd: '0.6rem' }}>
                      {(snippetsQ.data?.personal ?? []).length === 0 ? (
                        <p className="muted" style={{ fontSize: '0.85rem' }}>{t('comments.noneMine')}</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {snippetsQ.data?.personal.map((s) => (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ flex: 1, fontSize: '0.88rem' }}>{s.text}</span>
                              <button type="button" className="link-btn" aria-label={t('common.delete')} onClick={() => removeSnippet(s.id)}><Trash2 size={13} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="inline-form" style={{ padding: 0, marginBlockStart: '0.5rem' }}>
                        <div className="field" style={{ flex: '1 1 100%' }}><input className="input glass-inset" value={newSnip} onChange={(e) => setNewSnip(e.target.value)} placeholder={t('comments.addMinePlaceholder')} /></div>
                        <button type="button" className="btn btn--primary btn--sm" onClick={addPersonalSnippet} disabled={snipCreate.isPending || !newSnip.trim()}>{t('comments.addMine')}</button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {gridQ.data.students.map((r) => (
                      <div key={r.studentId} className="exam-remark-row">
                        <span className="merit-name" style={{ flex: '0 1 9rem' }}>{r.firstName} {r.lastName}</span>
                        <input className="input glass-inset" style={{ flex: 1 }} value={remarkDraft[r.studentId] ?? ''} placeholder={t('exams.remarkPlaceholder')} onChange={(e) => { remarkDirty.current.add(r.studentId); setRemarkDraft((d) => ({ ...d, [r.studentId]: e.target.value })); }} onBlur={(e) => blurRemark(r.studentId, e.target.value)} />
                        {allSnippets.length > 0 && (
                          <select className="input glass-inset" style={{ flex: '0 1 9rem' }} value="" onChange={(e) => { if (e.target.value) void insertSnippet(r.studentId, e.target.value); e.currentTarget.selectedIndex = 0; }}>
                            <option value="">{t('comments.insert')}</option>
                            {allSnippets.map((s) => <option key={s.id} value={s.text}>{s.text.length > 40 ? s.text.slice(0, 40) + '…' : s.text}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
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
