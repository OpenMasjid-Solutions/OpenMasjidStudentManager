// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Daily attendance for one class: pick a date, set each student present / absent / late /
 *  excused (with a bulk "all present"), and save. Shared by the teacher and admin class
 *  windows — the server scopes access + audits later edits. Phone-friendly + RTL-safe. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Clock, ShieldCheck } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { cn } from '../lib/cn';

type Status = 'present' | 'absent' | 'late' | 'excused';
const STATUSES: { id: Status; icon: React.ReactNode }[] = [
  { id: 'present', icon: <Check size={14} /> },
  { id: 'late', icon: <Clock size={14} /> },
  { id: 'absent', icon: <X size={14} /> },
  { id: 'excused', icon: <ShieldCheck size={14} /> },
];

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AttendancePanel({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [date, setDate] = useState(todayStr());
  const q = trpc.attendance.forClassDate.useQuery({ classId, date });
  const mark = trpc.attendance.mark.useMutation();

  const [draft, setDraft] = useState<Record<string, Status | undefined>>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const seededKey = useRef('');

  // Seed the draft from the server. Reset the dirty/saved flags ONLY when the loaded day
  // (class+date) actually changes — so a post-save refetch keeps the "Saved" label — and never
  // clobber unsaved edits on an unrelated refetch of the same day.
  useEffect(() => {
    if (!q.data) return;
    const key = `${classId}|${date}`;
    const keyChanged = seededKey.current !== key;
    if (!keyChanged && dirty) return; // in-progress edits on this day → don't overwrite
    const m: Record<string, Status | undefined> = {};
    for (const r of q.data.roster) m[r.studentId] = (r.status as Status | null) ?? undefined;
    setDraft(m);
    if (keyChanged) {
      seededKey.current = key;
      setDirty(false);
      setSaved(false);
    }
  }, [q.data, classId, date, dirty]);

  const roster = q.data?.roster ?? [];
  const marked = useMemo(() => roster.filter((r) => draft[r.studentId]).length, [roster, draft]);

  const setStatus = (sid: string, st: Status) => {
    setDraft((d) => ({ ...d, [sid]: st }));
    setDirty(true);
    setSaved(false);
  };
  const allPresent = () => {
    setDraft(Object.fromEntries(roster.map((r) => [r.studentId, 'present' as Status])));
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    const entries = roster.filter((r) => draft[r.studentId]).map((r) => ({ studentId: r.studentId, status: draft[r.studentId]! }));
    if (entries.length === 0) return;
    // Send the browser's local day so the server classifies a backfill by the masjid's clock.
    await mark.mutateAsync({ classId, date, clientToday: todayStr(), entries });
    await utils.attendance.forClassDate.invalidate({ classId, date });
    setDirty(false);
    setSaved(true);
  }

  // Switching days would replace the roster's marks — confirm if there's unsaved work.
  function changeDate(v: string) {
    if (dirty && !window.confirm(t('attendance.discardUnsaved'))) return;
    setDate(v || todayStr());
  }

  const isPast = date < todayStr();

  return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head"><h2>{t('attendance.title')}</h2><span className="spacer" /><span className="muted" style={{ fontSize: '0.85rem' }}>{t('attendance.markedCount', { n: marked, total: roster.length })}</span></div>

      <div className="att-toolbar">
        <div className="field" style={{ margin: 0 }}>
          <label className="label">{t('attendance.date')}</label>
          <input type="date" className="input glass-inset" value={date} max={todayStr()} onChange={(e) => changeDate(e.target.value)} />
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={allPresent} disabled={roster.length === 0}>{t('attendance.allPresent')}</button>
        <span className="spacer" style={{ flex: 1 }} />
        {isPast && <span className="week-warn">{t('attendance.pastDate')}</span>}
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!dirty || mark.isPending}>{saved && !dirty ? t('attendance.saved') : t('common.save')}</button>
      </div>

      {q.isLoading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : roster.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem' }}>{t('classes.noRoster')}</p>
      ) : (
        <div className="att-list">
          {roster.map((r) => (
            <div key={r.studentId} className="att-row glass-inset">
              <span className="name">{r.firstName} {r.lastName}</span>
              <span className="att-seg" role="group" aria-label={`${r.firstName} ${r.lastName}`}>
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={cn('att-seg-btn', `s-${s.id}`, draft[r.studentId] === s.id && 'is-active')}
                    aria-pressed={draft[r.studentId] === s.id}
                    title={t(`attendance.${s.id}`)}
                    onClick={() => setStatus(r.studentId, s.id)}
                  >
                    {s.icon}<span className="att-seg-label">{t(`attendance.${s.id}`)}</span>
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
