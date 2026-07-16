// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Admin directory: families as cards (with student + guardian chips), add a family. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { staggerContainer, staggerItem } from '../../lib/motion';
import { trpc } from '../../lib/trpc';

export function Directory({ onOpen }: { onOpen: (familyId: string) => void }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const dir = trpc.people.directory.useQuery();
  const createFamily = trpc.people.familyCreate.useMutation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createFamily.mutateAsync({ name: name.trim() });
    setName('');
    setAdding(false);
    await utils.people.directory.invalidate();
  }

  return (
    <>
      <div className="admin-header">
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('directory.title')}</h1>
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={() => setAdding((v) => !v)}>
          {t('directory.addFamily')}
        </button>
      </div>

      {adding && (
        <form className="inline-form glass-inset" onSubmit={add}>
          <div className="field">
            <label className="label" htmlFor="fam-name">{t('directory.familyName')}</label>
            <input id="fam-name" className="input glass-inset" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <button type="submit" className="btn btn--primary" disabled={createFamily.isPending}>{t('common.save')}</button>
        </form>
      )}

      {dir.isLoading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : !dir.data || dir.data.length === 0 ? (
        <p className="empty">{t('directory.empty')}</p>
      ) : (
        <motion.div className="card-grid" variants={staggerContainer} initial="initial" animate="animate">
          {dir.data.map((f) => (
            <motion.button key={f.id} type="button" className="fam-card glass fx-glint" variants={staggerItem} onClick={() => onOpen(f.id)}>
              <h3>
                {f.name}
                {f.status === 'archived' && <span className="chip is-muted" style={{ marginInlineStart: '0.5rem' }}>{t('directory.archived')}</span>}
              </h3>
              <div className="chip-row">
                {f.students.length ? (
                  f.students.map((s) => (
                    <span key={s.id} className={`chip ${s.status === 'withdrawn' ? 'is-muted' : ''}`}>
                      {s.firstName} {s.lastName.charAt(0)}.
                    </span>
                  ))
                ) : (
                  <span className="muted" style={{ fontSize: '0.82rem' }}>{t('directory.noStudents')}</span>
                )}
              </div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>
                {f.guardians.length ? f.guardians.map((g) => g.name).join(', ') : t('directory.noGuardians')}
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}
    </>
  );
}
