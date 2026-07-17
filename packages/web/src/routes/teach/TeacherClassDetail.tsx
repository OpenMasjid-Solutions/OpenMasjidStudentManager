// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** A teacher's read-only view of one of their own classes: type, weekly sessions, subjects
 *  and the active roster. Server enforces that the class is the caller's (mineGet 403s
 *  otherwise). Teachers never see PINs, notes, incidents or money (§5). Attendance and the
 *  gradebook arrive in the next slice. */
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { WeekGrid, type SessionRow } from '../../components/WeekGrid';
import { AttendancePanel } from '../../components/AttendancePanel';
import { GradebookPanel } from '../../components/GradebookPanel';
import { ExamsPanel } from '../../components/ExamsPanel';
import { MeritPanel } from '../../components/MeritPanel';

export function TeacherClassDetail({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const q = trpc.classes.mineGet.useQuery({ id: classId });

  if (q.isLoading) return <p className="empty">{t('common.loading')}</p>;
  if (q.isError || !q.data) return <p className="empty">{t('teach.classDenied')}</p>;
  const { class: cls, subjects, teachers, roster, sessions } = q.data;

  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    classId: cls.id,
    className: cls.name,
    classType: cls.type,
    customLabel: cls.customLabel,
    dayOfWeek: s.dayOfWeek,
    startMin: s.startMin,
    endMin: s.endMin,
    room: s.room,
  }));

  return (
    <div className="win-content">
      <div className="chip-row" style={{ marginBlockEnd: '1rem' }}>
        <span className="chip">{cls.type === 'custom' && cls.customLabel ? cls.customLabel : t(`ctype.${cls.type}`)}</span>
        {cls.scheduleLabel && <span className="muted">{cls.scheduleLabel}</span>}
      </div>

      {/* Attendance — the teacher's daily tool */}
      <AttendancePanel classId={cls.id} />

      {/* Gradebook */}
      <GradebookPanel classId={cls.id} />

      {/* Exam score entry */}
      <ExamsPanel classId={cls.id} />

      {/* Merit points */}
      <MeritPanel classId={cls.id} />

      {/* Schedule */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('schedule.title')}</h2></div>
        <WeekGrid sessions={rows} emptyText={t('schedule.noSessions')} />
      </section>

      {/* Subjects */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('classes.subjects')}</h2></div>
        <div className="chip-row">
          {subjects.length ? subjects.map((s) => <span key={s.id} className="chip">{s.name}</span>) : <span className="muted">{t('classes.noSubjects')}</span>}
        </div>
      </section>

      {/* Co-teachers */}
      {teachers.length > 1 && (
        <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
          <div className="section-head"><h2>{t('classes.teachers')}</h2></div>
          <div className="chip-row">{teachers.map((tt) => <span key={tt.userId} className="chip is-muted">{tt.displayName ?? tt.username}</span>)}</div>
        </section>
      )}

      {/* Roster (read-only, no PINs) */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('classes.roster')}</h2><span className="spacer" /><span className="muted" style={{ fontSize: '0.85rem' }}>{roster.length}</span></div>
        {roster.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('classes.noRoster')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <tbody>
                {roster.map((r) => (
                  <tr key={r.studentId}><td>{r.firstName} {r.lastName}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
