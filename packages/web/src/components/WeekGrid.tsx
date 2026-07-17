// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** A week-at-a-glance timetable: sessions grouped into day columns (auto-fitting so it
 *  collapses to a single column on a phone), each session a card with its time, class and
 *  room. Locale-agnostic (minutes → Intl), RTL-safe (logical properties), and print-clean
 *  (see .week-grid print rules). Shared by the admin Timetable and a teacher's My Week. */
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { minToLabel } from '../lib/time';

export interface SessionRow {
  id: string;
  classId: string;
  className: string;
  classType: 'maktab' | 'hifz' | 'nazrah' | 'alim' | 'custom';
  customLabel?: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  room?: string | null;
}

/** Days in week order (0=Sun … 6=Sat). */
const DAYS = [0, 1, 2, 3, 4, 5, 6];

export function WeekGrid({ sessions, emptyText }: { sessions: SessionRow[]; emptyText?: string }) {
  const { t, i18n } = useTranslation();
  if (sessions.length === 0) return <p className="empty">{emptyText ?? t('schedule.empty')}</p>;

  // Only show days that actually have sessions — less empty space, still ordered.
  const days = DAYS.filter((d) => sessions.some((s) => s.dayOfWeek === d));
  const typeLabel = (s: SessionRow) => (s.classType === 'custom' && s.customLabel ? s.customLabel : t(`ctype.${s.classType}`));

  return (
    <div className="week-grid">
      {days.map((d) => {
        const daySessions = sessions.filter((s) => s.dayOfWeek === d).sort((a, b) => a.startMin - b.startMin);
        return (
          <section key={d} className="week-day glass">
            <h3 className="week-day-name">{t(`days.${d}`)}</h3>
            <div className="week-day-list">
              {daySessions.map((s) => (
                <div key={s.id} className="week-session glass-inset">
                  <span className="week-session-time">{minToLabel(s.startMin, i18n.language)} – {minToLabel(s.endMin, i18n.language)}</span>
                  <span className="week-session-class">{s.className}</span>
                  <span className="week-session-type">{typeLabel(s)}</span>
                  {s.room && <span className="week-session-room"><MapPin size={13} aria-hidden="true" /> {s.room}</span>}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
