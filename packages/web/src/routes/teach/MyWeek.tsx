// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** A teacher's own weekly schedule (scoped server-side to the caller — §5). Printable. */
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { fadeRise } from '../../lib/motion';
import { trpc } from '../../lib/trpc';
import { WeekGrid } from '../../components/WeekGrid';

export function MyWeek() {
  const { t } = useTranslation();
  const q = trpc.schedule.mySchedule.useQuery();
  const sessions = q.data ?? [];

  return (
    <div className="page">
      <div className="admin-header">
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.myWeek')}</h1>
        <span className="spacer" />
        {sessions.length > 0 && <button type="button" className="btn btn--ghost no-print" onClick={() => window.print()}><Printer size={16} /> {t('schedule.print')}</button>}
      </div>

      <motion.div className="glass no-print" style={{ padding: '1.1rem 1.3rem', marginBlockEnd: '1.1rem' }} variants={fadeRise} initial="initial" animate="animate">
        <h2 style={{ margin: '0 0 0.3rem' }}>{t('dashboard.welcome')}</h2>
        <p className="page-sub" style={{ margin: 0 }}>{t('teach.weekIntro')}</p>
      </motion.div>

      <div className="print-area">
        {q.isLoading ? <p className="empty">{t('common.loading')}</p> : <WeekGrid sessions={sessions} emptyText={t('teach.noSessions')} />}
      </div>
    </div>
  );
}
