// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Admin timetable — the week viewed BY CLASS, BY TEACHER or BY STUDENT (§4). Pick a term,
 *  a mode and an entity; the shared WeekGrid renders it, and Print produces a clean handout. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { WeekGrid } from '../../components/WeekGrid';
import { cn } from '../../lib/cn';

type Mode = 'class' | 'teacher' | 'student';

export function Timetable() {
  const { t } = useTranslation();
  const termsQ = trpc.classes.termList.useQuery();
  const [selTerm, setSelTerm] = useState<string | null>(null);
  const termId = selTerm ?? termsQ.data?.find((x) => x.isCurrent)?.id ?? termsQ.data?.[0]?.id ?? null;

  const [mode, setMode] = useState<Mode>('class');
  const [entity, setEntity] = useState('');

  const classesQ = trpc.classes.classList.useQuery(termId ? { termId } : undefined, { enabled: mode === 'class' && !!termId });
  const staffQ = trpc.staff.list.useQuery(undefined, { enabled: mode === 'teacher' });
  const dirQ = trpc.people.directory.useQuery(undefined, { enabled: mode === 'student' });

  const byClass = trpc.schedule.byClass.useQuery({ classId: entity }, { enabled: mode === 'class' && !!entity });
  const byTeacher = trpc.schedule.byTeacher.useQuery({ userId: entity, termId: termId ?? undefined }, { enabled: mode === 'teacher' && !!entity });
  const byStudent = trpc.schedule.byStudent.useQuery({ studentId: entity, termId: termId ?? undefined }, { enabled: mode === 'student' && !!entity });

  const sessions = mode === 'class' ? (byClass.data?.sessions ?? []) : mode === 'teacher' ? (byTeacher.data ?? []) : (byStudent.data ?? []);

  const teacherOptions = (staffQ.data ?? []).filter((u) => u.role === 'teacher');
  const studentOptions = (dirQ.data ?? []).flatMap((f) => f.students.filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, family: f.name })));

  function pickMode(m: Mode) {
    setMode(m);
    setEntity('');
  }

  return (
    <div className="page">
      <div className="admin-header">
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.timetable')}</h1>
        <span className="spacer" />
        {sessions.length > 0 && <button type="button" className="btn btn--ghost no-print" onClick={() => window.print()}><Printer size={16} /> {t('schedule.print')}</button>}
      </div>

      {/* Term chips */}
      {(termsQ.data ?? []).length > 0 && (
        <div className="chip-row no-print" style={{ marginBlockEnd: '0.75rem' }}>
          {termsQ.data?.map((tm) => (
            <button key={tm.id} type="button" className={`chip ${tm.id === termId ? 'is-accent' : ''}`} onClick={() => { setSelTerm(tm.id); setEntity(''); }}>
              {tm.name}{tm.isCurrent && ` · ${t('classes.current')}`}
            </button>
          ))}
        </div>
      )}

      {/* Mode + entity */}
      <div className="inline-form glass-inset no-print" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label className="label">{t('schedule.viewBy')}</label>
          <div className="chip-row">
            {(['class', 'teacher', 'student'] as Mode[]).map((m) => (
              <button key={m} type="button" className={cn('chip', mode === m && 'is-accent')} onClick={() => pickMode(m)}>{t(`schedule.by_${m}`)}</button>
            ))}
          </div>
        </div>
        <div className="field" style={{ flex: '1 1 16rem' }}>
          <label className="label">{t(`schedule.pick_${mode}`)}</label>
          <select className="input glass-inset" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">{t(`schedule.choose_${mode}`)}</option>
            {mode === 'class' && (classesQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {mode === 'teacher' && teacherOptions.map((u) => <option key={u.id} value={u.id}>{u.displayName ?? u.username}</option>)}
            {mode === 'student' && studentOptions.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.family}</option>)}
          </select>
        </div>
      </div>

      <div className="print-area" style={{ marginBlockStart: '1.1rem' }}>
        {!entity ? <p className="empty">{t('schedule.pickToView')}</p> : <WeekGrid sessions={sessions} />}
      </div>
    </div>
  );
}
