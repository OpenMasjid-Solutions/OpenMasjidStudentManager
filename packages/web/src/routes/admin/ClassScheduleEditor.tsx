// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The weekly-session editor inside a class window: list the class's sessions (with soft
 *  double-booking warnings), add a session (day + start/end + room), or remove one. Warnings
 *  never block — they're surfaced so the admin can decide (§4). */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { minToLabel, inputValueToMin } from '../../lib/time';

interface Warning { kind: 'teacher' | 'room'; otherClass: string; teacher?: string; room?: string }

function WarningLine({ w }: { w: Warning }) {
  const { t } = useTranslation();
  return (
    <span className="week-warn">
      <AlertTriangle size={13} aria-hidden="true" />
      {w.kind === 'teacher' ? t('schedule.warnTeacher', { teacher: w.teacher, class: w.otherClass }) : t('schedule.warnRoom', { room: w.room, class: w.otherClass })}
    </span>
  );
}

export function ClassScheduleEditor({ classId }: { classId: string }) {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const q = trpc.schedule.byClass.useQuery({ classId });
  const create = trpc.schedule.createSession.useMutation();
  const del = trpc.schedule.deleteSession.useMutation();

  const [day, setDay] = useState(1);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [room, setRoom] = useState('');
  const [lastWarnings, setLastWarnings] = useState<Warning[]>([]);

  const refresh = () => utils.schedule.byClass.invalidate({ classId });

  async function add() {
    const startMin = inputValueToMin(start);
    const endMin = inputValueToMin(end);
    if (endMin <= startMin) return;
    const r = await create.mutateAsync({ classId, dayOfWeek: day, startMin, endMin, room: room.trim() || undefined });
    setLastWarnings(r.warnings);
    setRoom('');
    await refresh();
  }

  const sessions = q.data?.sessions ?? [];

  return (
    <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
      <div className="section-head"><h2>{t('schedule.title')}</h2></div>

      {sessions.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.9rem' }}>{t('schedule.noSessions')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {sessions.map((s) => (
            <div key={s.id} className="glass-inset" style={{ padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-button)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <strong style={{ minInlineSize: '5.5rem' }}>{t(`days.${s.dayOfWeek}`)}</strong>
                <span>{minToLabel(s.startMin, i18n.language)} – {minToLabel(s.endMin, i18n.language)}</span>
                {s.room && <span className="chip is-muted">{s.room}</span>}
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="btn btn--ghost btn--sm" aria-label={t('common.delete')} onClick={async () => { await del.mutateAsync({ id: s.id }); await refresh(); }}><Trash2 size={15} /></button>
              </div>
              {s.warnings.length > 0 && <div style={{ marginBlockStart: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>{s.warnings.map((w, i) => <WarningLine key={i} w={w} />)}</div>}
            </div>
          ))}
        </div>
      )}

      {lastWarnings.length > 0 && (
        <div className="notice notice--warn" style={{ marginBlockStart: '0.6rem' }}>
          <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{t('schedule.addedWithWarnings')}</p>
          {lastWarnings.map((w, i) => <WarningLine key={i} w={w} />)}
        </div>
      )}

      <div className="inline-form" style={{ padding: 0, marginBlockStart: '0.6rem', alignItems: 'flex-end' }}>
        <div className="field"><label className="label">{t('schedule.day')}</label>
          <select className="input glass-inset" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`days.${d}`)}</option>)}
          </select>
        </div>
        <div className="field"><label className="label">{t('schedule.start')}</label><input type="time" className="input glass-inset" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label className="label">{t('schedule.end')}</label><input type="time" className="input glass-inset" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="field"><label className="label">{t('schedule.room')}</label><input className="input glass-inset" value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('schedule.roomHint')} /></div>
        <button type="button" className="btn btn--primary" onClick={add} disabled={create.isPending || inputValueToMin(end) <= inputValueToMin(start)}>{t('schedule.addSession')}</button>
      </div>
      <p className="hint" style={{ marginBlockStart: '0.5rem' }}>{t('schedule.manualHint')}</p>
    </section>
  );
}
