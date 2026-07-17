// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Admin exams: per term, define exams and assign them to classes (which snapshots each class's
 *  subjects). Per assigned class: a completion count, per-subject max marks, and unassign. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fadeRise } from '../../lib/motion';
import { trpc } from '../../lib/trpc';

function MaxMarks({ examId, classId }: { examId: string; classId: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const q = trpc.exams.grid.useQuery({ examId, classId });
  const setMax = trpc.exams.setSubjectMax.useMutation();
  if (!q.data) return <p className="muted" style={{ fontSize: '0.85rem' }}>{t('common.loading')}</p>;
  return (
    <div className="chip-row" style={{ gap: '0.6rem', marginBlockStart: '0.5rem' }}>
      {q.data.subjects.map((s) => (
        <label key={s.id} className="exam-max">
          <span className="muted" style={{ fontSize: '0.8rem' }}>{s.name}</span>
          <input type="number" min="1" className="input glass-inset" style={{ width: '4.5rem', padding: '0.25rem 0.4rem', textAlign: 'center' }} defaultValue={s.maxMarks} key={`${s.id}|${s.maxMarks}`}
            onBlur={async (e) => { const v = parseInt(e.target.value, 10); if (!v || v === s.maxMarks) return; try { await setMax.mutateAsync({ subjectId: s.id, maxMarks: v }); } catch { /* over an entered mark */ } await utils.exams.grid.invalidate({ examId, classId }); }} />
        </label>
      ))}
      {q.data.subjects.length === 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>{t('exams.noSubjects')}</span>}
    </div>
  );
}

export function Exams() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const termsQ = trpc.classes.termList.useQuery();
  const [selTerm, setSelTerm] = useState<string | null>(null);
  const termId = selTerm ?? termsQ.data?.find((x) => x.isCurrent)?.id ?? termsQ.data?.[0]?.id ?? null;

  const examsQ = trpc.exams.examList.useQuery({ termId: termId! }, { enabled: !!termId });
  const classesQ = trpc.classes.classList.useQuery(termId ? { termId } : undefined, { enabled: !!termId });
  const [selExam, setSelExam] = useState<string | null>(null);
  const examId = selExam && (examsQ.data ?? []).some((e) => e.id === selExam) ? selExam : examsQ.data?.[0]?.id ?? null;
  const completionQ = trpc.exams.completion.useQuery({ examId: examId! }, { enabled: !!examId });

  const create = trpc.exams.examCreate.useMutation();
  const assign = trpc.exams.assignClass.useMutation();
  const unassign = trpc.exams.unassignClass.useMutation();

  const [name, setName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const assigned = new Map((completionQ.data ?? []).map((c) => [c.classId, c]));

  async function addExam(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !termId) return;
    const r = await create.mutateAsync({ termId, name: name.trim() });
    setName('');
    await utils.exams.examList.invalidate({ termId });
    setSelExam(r.id);
  }
  async function toggleClass(classId: string, isAssigned: boolean) {
    if (isAssigned) {
      if (!window.confirm(t('exams.confirmUnassign'))) return;
      await unassign.mutateAsync({ examId: examId!, classId });
    } else {
      await assign.mutateAsync({ examId: examId!, classId });
    }
    await utils.exams.completion.invalidate({ examId: examId! });
  }

  return (
    <motion.div className="page" variants={fadeRise} initial="initial" animate="animate">
      <div className="admin-header"><h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.exams')}</h1></div>

      {/* Terms */}
      {(termsQ.data ?? []).length > 0 && (
        <div className="chip-row" style={{ marginBlockEnd: '0.75rem' }}>
          {termsQ.data?.map((tm) => <button key={tm.id} type="button" className={`chip ${tm.id === termId ? 'is-accent' : ''}`} onClick={() => { setSelTerm(tm.id); setSelExam(null); }}>{tm.name}{tm.isCurrent && ` · ${t('classes.current')}`}</button>)}
        </div>
      )}

      {!termId ? (
        <p className="empty">{t('exams.noTerms')}</p>
      ) : (
        <>
          {/* Exams */}
          <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
            <div className="section-head"><h2>{t('exams.exams')}</h2></div>
            <div className="chip-row" style={{ marginBlockEnd: '0.6rem' }}>
              {(examsQ.data ?? []).map((e) => <button key={e.id} type="button" className={`chip ${e.id === examId ? 'is-accent' : ''}`} onClick={() => setSelExam(e.id)}>{e.name}</button>)}
              {(examsQ.data ?? []).length === 0 && <span className="muted" style={{ fontSize: '0.9rem' }}>{t('exams.noExams')}</span>}
            </div>
            <form className="inline-form glass-inset" onSubmit={addExam} style={{ marginBlockStart: 0 }}>
              <div className="field"><label className="label">{t('exams.examName')}</label><input className="input glass-inset" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('exams.examNameHint')} /></div>
              <button type="submit" className="btn btn--primary" disabled={create.isPending}>{t('exams.addExam')}</button>
            </form>
          </section>

          {/* Assign classes + completion */}
          {examId && (
            <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
              <div className="section-head"><h2>{t('exams.classes')}</h2></div>
              {(classesQ.data ?? []).filter((c) => c.status === 'active').length === 0 ? (
                <p className="muted" style={{ fontSize: '0.9rem' }}>{t('exams.noClasses')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(classesQ.data ?? []).filter((c) => c.status === 'active').map((c) => {
                    const comp = assigned.get(c.id);
                    const isAssigned = !!comp;
                    return (
                      <div key={c.id} className="glass-inset" style={{ padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-button)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={isAssigned} onChange={() => toggleClass(c.id, isAssigned)} />
                            <strong>{c.name}</strong>
                          </label>
                          {comp && <span className="muted" style={{ fontSize: '0.85rem' }}>· {t('exams.entered', { n: comp.entered, total: comp.total })} ({comp.percent}%)</span>}
                          <span className="spacer" style={{ flex: 1 }} />
                          {isAssigned && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>{t('exams.marksOutOf')}</button>}
                        </div>
                        {isAssigned && expanded === c.id && <MaxMarks examId={examId} classId={c.id} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </motion.div>
  );
}
