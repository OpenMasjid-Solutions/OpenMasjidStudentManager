// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** A teacher's own classes as cards → open a read-only class window (§5 scoping). */
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { staggerContainer, staggerItem } from '../../lib/motion';
import { trpc } from '../../lib/trpc';
import { useWindows } from '../../components/Windows';
import { TeacherClassDetail } from './TeacherClassDetail';

export function MyClasses() {
  const { t } = useTranslation();
  const { open } = useWindows();
  const q = trpc.classes.mine.useQuery();

  const typeLabel = (ty: string, custom?: string | null) => (ty === 'custom' && custom ? custom : t(`ctype.${ty}`));

  return (
    <div className="page">
      <div className="admin-header"><h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.myClasses')}</h1></div>

      {q.isLoading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="empty">{t('teach.noClasses')}</p>
      ) : (
        <motion.div className="card-grid" variants={staggerContainer} initial="initial" animate="animate">
          {q.data.map((c) => (
            <motion.button key={c.id} type="button" className="fam-card glass fx-glint" variants={staggerItem} onClick={() => open({ title: c.name, wide: true, dedupeKey: `class:${c.id}`, icon: <GraduationCap size={15} />, node: <TeacherClassDetail classId={c.id} /> })}>
              <h3>{c.name}</h3>
              <div className="chip-row"><span className="chip">{typeLabel(c.type, c.customLabel)}</span>{c.scheduleLabel && <span className="muted" style={{ fontSize: '0.82rem' }}>{c.scheduleLabel}</span>}</div>
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
