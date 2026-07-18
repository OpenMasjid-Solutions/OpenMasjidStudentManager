// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** One child's academics in the parent portal (read-only, CLAUDE.md §4/§5/§15): grades by class,
 *  attendance tallies, and merit points. Phone-first; every read is family-scoped server-side. */
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { staggerContainer, staggerItem } from '../../lib/motion';
import { trpc } from '../../lib/trpc';

export function ChildDetail({ studentId, name, onBack }: { studentId: string; name: string; onBack: () => void }) {
  const { t } = useTranslation();
  const gradesQ = trpc.portal.childGrades.useQuery({ studentId });
  const attQ = trpc.portal.childAttendance.useQuery({ studentId });
  const meritQ = trpc.portal.childMerit.useQuery({ studentId });
  const fmtDate = (v: unknown) => new Date(v as number).toLocaleDateString();
  const score = (pts: number | null, max: number) => (pts == null ? '—' : `${pts} / ${max}`);
  // A transient failure must not masquerade as "no records" (parent portal = the face of the madrasa).
  const state = (q: { isLoading: boolean; isError: boolean }): 'loading' | 'error' | 'ok' => (q.isError ? 'error' : q.isLoading ? 'loading' : 'ok');
  const Placeholder = ({ s }: { s: 'loading' | 'error' }) => <div className="fam-empty">{t(s === 'error' ? 'family.loadError' : 'status.connecting')}</div>;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onBack} style={{ alignSelf: 'flex-start', gap: '0.25rem' }}>
        <ChevronLeft size={16} /> {t('family.back')}
      </button>
      <div className="fam-hello"><h1>{name}</h1></div>

      {/* Merit */}
      <motion.section className="fam-section" variants={staggerItem}>
        <h2>{t('family.merit')}</h2>
        {state(meritQ) !== 'ok' ? (
          <Placeholder s={state(meritQ) as 'loading' | 'error'} />
        ) : (
          <>
            <div className="balance-card glass-raised" style={{ padding: '0.9rem' }}>
              <div className="amt credit" style={{ fontSize: '1.8rem' }}>{meritQ.data!.total}</div>
              <div className="sub">{t('family.meritPoints')}</div>
            </div>
            {meritQ.data!.history.map((m, i) => (
              <div key={i} className="list-row glass">
                <div className="row-main">
                  <span className="row-title">{m.category}</span>
                  <span className="row-sub">{fmtDate(m.at)}{m.note ? ` · ${m.note}` : ''}</span>
                </div>
                <span className={`row-amt ${m.points < 0 ? 'neg' : 'pos'}`}>{m.points > 0 ? `+${m.points}` : m.points}</span>
              </div>
            ))}
            {meritQ.data!.history.length === 0 && <div className="fam-empty">{t('family.noMerit')}</div>}
          </>
        )}
      </motion.section>

      {/* Attendance */}
      <motion.section className="fam-section" variants={staggerItem}>
        <h2>{t('family.attendance')}</h2>
        {state(attQ) !== 'ok' ? (
          <Placeholder s={state(attQ) as 'loading' | 'error'} />
        ) : attQ.data && attQ.data.total > 0 ? (
          <>
            <div className="att-stats">
              {(['present', 'late', 'excused', 'absent'] as const).map((s) => (
                <div key={s} className={`att-stat glass att-${s}`}>
                  <div className="n">{attQ.data!.counts[s]}</div>
                  <div className="k">{t(`family.att_${s}`)}</div>
                </div>
              ))}
            </div>
            {attQ.data.recent.map((r, i) => (
              <div key={i} className="list-row glass">
                <div className="row-main">
                  <span className="row-title">{r.className}</span>
                  <span className="row-sub">{r.date}</span>
                </div>
                <span className={`chip att-chip att-${r.status}`}>{t(`family.att_${r.status}`)}</span>
              </div>
            ))}
          </>
        ) : (
          <div className="fam-empty">{t('family.noAttendance')}</div>
        )}
      </motion.section>

      {/* Grades */}
      <motion.section className="fam-section" variants={staggerItem}>
        <h2>{t('family.grades')}</h2>
        {state(gradesQ) !== 'ok' ? (
          <Placeholder s={state(gradesQ) as 'loading' | 'error'} />
        ) : gradesQ.data && gradesQ.data.classes.length > 0 ? (
          gradesQ.data.classes.map((c) => (
            <div key={c.classId} style={{ marginBlockEnd: '0.8rem' }}>
              <div className="row-sub" style={{ fontWeight: 600, marginBlockEnd: '0.4rem' }}>{c.className}</div>
              {c.items.length === 0 ? (
                <div className="fam-empty" style={{ padding: '0.25rem 0.25rem' }}>{t('family.noGrades')}</div>
              ) : (
                c.items.map((it, i) => (
                  <div key={i} className="list-row glass">
                    <div className="row-main">
                      <span className="row-title">{it.title}</span>
                      {(it.category || it.date) && <span className="row-sub">{[it.category, it.date].filter(Boolean).join(' · ')}</span>}
                    </div>
                    <span className="row-amt">{score(it.points, it.maxPoints)}</span>
                  </div>
                ))
              )}
            </div>
          ))
        ) : (
          <div className="fam-empty">{t('family.noGrades')}</div>
        )}
      </motion.section>
    </motion.div>
  );
}
