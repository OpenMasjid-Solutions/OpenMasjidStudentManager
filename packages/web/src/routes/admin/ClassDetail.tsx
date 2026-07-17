// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** One class (window content): ordered subjects, teacher assignment, and the roster. */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { ClassScheduleEditor } from './ClassScheduleEditor';
import { AttendancePanel } from '../../components/AttendancePanel';
import { GradebookPanel } from '../../components/GradebookPanel';

export function ClassDetail({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const q = trpc.classes.classGet.useQuery({ id: classId });
  const staffQ = trpc.staff.list.useQuery();
  const dirQ = trpc.people.directory.useQuery();
  const setSubjects = trpc.classes.setSubjects.useMutation();
  const assign = trpc.classes.assignTeacher.useMutation();
  const unassign = trpc.classes.unassignTeacher.useMutation();
  const enroll = trpc.classes.enroll.useMutation();
  const unenroll = trpc.classes.unenroll.useMutation();

  const [subjInput, setSubjInput] = useState('');
  useEffect(() => {
    if (q.data) setSubjInput(q.data.subjects.map((s) => s.name).join(', '));
  }, [q.data]);
  const [teacherSel, setTeacherSel] = useState('');
  const [studentSel, setStudentSel] = useState('');

  const refresh = () => utils.classes.classGet.invalidate({ id: classId });

  async function saveSubjects() {
    await setSubjects.mutateAsync({ classId, subjects: subjInput.split(',').map((s) => s.trim()).filter(Boolean) });
    await refresh();
  }
  async function addTeacher() {
    if (!teacherSel) return;
    await assign.mutateAsync({ classId, userId: teacherSel });
    setTeacherSel('');
    await refresh();
  }
  async function addStudent() {
    if (!studentSel) return;
    await enroll.mutateAsync({ classId, studentId: studentSel });
    setStudentSel('');
    await refresh();
  }

  if (q.isLoading || !q.data) return <p className="empty">{t('common.loading')}</p>;
  const { class: cls, subjects, teachers, roster } = q.data;
  const activeRoster = roster.filter((r) => r.status === 'active');
  const teacherOptions = (staffQ.data ?? []).filter((u) => u.role === 'teacher' && u.status === 'active' && !teachers.some((tt) => tt.userId === u.id));
  const enrolledIds = new Set(activeRoster.map((r) => r.studentId));
  const studentOptions = (dirQ.data ?? []).flatMap((f) => f.students.filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, family: f.name }))).filter((s) => !enrolledIds.has(s.id));

  return (
    <div className="win-content">
      <div className="chip-row" style={{ marginBlockEnd: '1rem' }}>
        <span className="chip">{cls.type === 'custom' && cls.customLabel ? cls.customLabel : t(`ctype.${cls.type}`)}</span>
        {cls.scheduleLabel && <span className="muted">{cls.scheduleLabel}</span>}
      </div>

      {/* Subjects */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('classes.subjects')}</h2></div>
        <div className="chip-row" style={{ marginBlockEnd: '0.6rem' }}>
          {subjects.length ? subjects.map((s) => <span key={s.id} className="chip">{s.name}</span>) : <span className="muted">{t('classes.noSubjects')}</span>}
        </div>
        <div className="inline-form" style={{ padding: 0 }}>
          <div className="field" style={{ flex: '1 1 100%' }}><label className="label">{t('classes.subjects')}</label><input className="input glass-inset" value={subjInput} onChange={(e) => setSubjInput(e.target.value)} placeholder={t('classes.subjectsHint')} /></div>
        </div>
        <button type="button" className="btn btn--primary btn--sm" style={{ marginBlockStart: '0.6rem' }} onClick={saveSubjects} disabled={setSubjects.isPending}>{t('common.save')}</button>
      </section>

      {/* Weekly schedule */}
      <ClassScheduleEditor classId={classId} />

      {/* Attendance */}
      <AttendancePanel classId={classId} />

      {/* Gradebook (admin also configures the class's grading scale) */}
      <GradebookPanel classId={classId} canConfigScale />

      {/* Teachers */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('classes.teachers')}</h2></div>
        {teachers.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('classes.noTeachers')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {teachers.map((tt) => (
              <div key={tt.userId} className="glass-inset" style={{ padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-button)', display: 'flex', alignItems: 'center' }}>
                <strong>{tt.displayName ?? tt.username}</strong>
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await unassign.mutateAsync({ classId, userId: tt.userId }); await refresh(); }}>{t('classes.remove')}</button>
              </div>
            ))}
          </div>
        )}
        <div className="inline-form" style={{ padding: 0, marginBlockStart: '0.6rem' }}>
          <div className="field"><label className="label">{t('classes.addTeacher')}</label>
            <select className="input glass-inset" value={teacherSel} onChange={(e) => setTeacherSel(e.target.value)}>
              <option value="">{t('classes.chooseTeacher')}</option>
              {teacherOptions.map((u) => <option key={u.id} value={u.id}>{u.displayName ?? u.username}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn--primary" onClick={addTeacher} disabled={!teacherSel || assign.isPending}>{t('classes.assign')}</button>
        </div>
      </section>

      {/* Roster */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('classes.roster')}</h2><span className="spacer" /><span className="muted" style={{ fontSize: '0.85rem' }}>{activeRoster.length}</span></div>
        {activeRoster.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('classes.noRoster')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <tbody>
                {activeRoster.map((r) => (
                  <tr key={r.enrollmentId}>
                    <td>{r.firstName} {r.lastName}</td>
                    <td className="actions"><button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await unenroll.mutateAsync({ enrollmentId: r.enrollmentId }); await refresh(); }}>{t('classes.unenroll')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="inline-form" style={{ padding: 0, marginBlockStart: '0.6rem' }}>
          <div className="field"><label className="label">{t('classes.enroll')}</label>
            <select className="input glass-inset" value={studentSel} onChange={(e) => setStudentSel(e.target.value)}>
              <option value="">{t('classes.chooseStudent')}</option>
              {studentOptions.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.family}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn--primary" onClick={addStudent} disabled={!studentSel || enroll.isPending}>{t('classes.enroll')}</button>
        </div>
      </section>
    </div>
  );
}
