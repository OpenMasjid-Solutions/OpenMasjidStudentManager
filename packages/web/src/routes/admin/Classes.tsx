// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Classes for the selected term (cards → open a class window). Terms are managed
 *  inline (add, set current). */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { staggerContainer, staggerItem } from '../../lib/motion';
import { trpc } from '../../lib/trpc';
import { useWindows } from '../../components/Windows';
import { ClassDetail } from './ClassDetail';

type ClassType = 'maktab' | 'hifz' | 'nazrah' | 'alim' | 'custom';
const TYPES: ClassType[] = ['maktab', 'hifz', 'nazrah', 'alim', 'custom'];

export function Classes() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { open } = useWindows();
  const termsQ = trpc.classes.termList.useQuery();
  const [selTerm, setSelTerm] = useState<string | null>(null);
  const effectiveTerm = selTerm ?? termsQ.data?.find((x) => x.isCurrent)?.id ?? termsQ.data?.[0]?.id ?? null;
  const classesQ = trpc.classes.classList.useQuery(effectiveTerm ? { termId: effectiveTerm } : undefined, { enabled: !!effectiveTerm });

  const createTerm = trpc.classes.termCreate.useMutation();
  const setCurrent = trpc.classes.termSetCurrent.useMutation();
  const createClass = trpc.classes.classCreate.useMutation();
  const closeTerm = trpc.classes.termClose.useMutation();
  const reopenTerm = trpc.classes.termReopen.useMutation();

  const selectedTermObj = (termsQ.data ?? []).find((x) => x.id === effectiveTerm) ?? null;
  async function toggleClose() {
    if (!selectedTermObj) return;
    if (selectedTermObj.closedAt) {
      await reopenTerm.mutateAsync({ id: selectedTermObj.id });
    } else {
      if (!window.confirm(t('classes.confirmClose'))) return;
      await closeTerm.mutateAsync({ id: selectedTermObj.id });
    }
    await utils.classes.termList.invalidate();
  }

  const [addTerm, setAddTerm] = useState(false);
  const [termName, setTermName] = useState('');
  const [addClass, setAddClass] = useState(false);
  const [cls, setCls] = useState<{ name: string; type: ClassType; customLabel: string; scheduleLabel: string }>({ name: '', type: 'maktab', customLabel: '', scheduleLabel: '' });

  const typeLabel = (ty: ClassType, custom?: string | null) => (ty === 'custom' && custom ? custom : t(`ctype.${ty}`));

  async function submitTerm(e: FormEvent) {
    e.preventDefault();
    if (!termName.trim()) return;
    const r = await createTerm.mutateAsync({ name: termName.trim(), isCurrent: (termsQ.data ?? []).length === 0 });
    setTermName('');
    setAddTerm(false);
    await utils.classes.termList.invalidate();
    setSelTerm(r.id);
  }
  async function makeCurrent(id: string) {
    await setCurrent.mutateAsync({ id });
    await utils.classes.termList.invalidate();
  }
  async function submitClass(e: FormEvent) {
    e.preventDefault();
    if (!cls.name.trim() || !effectiveTerm) return;
    const r = await createClass.mutateAsync({ termId: effectiveTerm, name: cls.name.trim(), type: cls.type, customLabel: cls.type === 'custom' ? cls.customLabel || undefined : undefined, scheduleLabel: cls.scheduleLabel || undefined });
    setCls({ name: '', type: 'maktab', customLabel: '', scheduleLabel: '' });
    setAddClass(false);
    await utils.classes.classList.invalidate();
    open({ title: cls.name.trim(), wide: true, dedupeKey: `class:${r.id}`, icon: <GraduationCap size={15} />, node: <ClassDetail classId={r.id} /> });
  }

  return (
    <div className="page">
      <div className="admin-header">
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.classes')}</h1>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={() => setAddTerm((v) => !v)}>{t('classes.addTerm')}</button>
        {selectedTermObj && <button type="button" className="btn btn--ghost" onClick={toggleClose} disabled={closeTerm.isPending || reopenTerm.isPending}>{selectedTermObj.closedAt ? t('classes.reopenTerm') : t('classes.closeTerm')}</button>}
        {effectiveTerm && <button type="button" className="btn btn--primary" onClick={() => setAddClass((v) => !v)}>{t('classes.addClass')}</button>}
      </div>
      {selectedTermObj?.closedAt && <p className="hint" style={{ marginBlockEnd: '0.75rem' }}>{t('classes.closedNote')}</p>}

      {/* Terms */}
      {(termsQ.data ?? []).length > 0 && (
        <div className="chip-row" style={{ marginBlockEnd: '1rem' }}>
          {termsQ.data?.map((tm) => (
            <button key={tm.id} type="button" className={`chip ${tm.id === effectiveTerm ? 'is-accent' : ''}`} onClick={() => setSelTerm(tm.id)} onDoubleClick={() => makeCurrent(tm.id)} title={t('classes.setCurrentHint')}>
              {tm.name}{tm.isCurrent && ` · ${t('classes.current')}`}{tm.closedAt && ` · ${t('classes.closed')}`}
            </button>
          ))}
        </div>
      )}
      {addTerm && (
        <form className="inline-form glass-inset" onSubmit={submitTerm}>
          <div className="field"><label className="label">{t('classes.termName')}</label><input className="input glass-inset" value={termName} onChange={(e) => setTermName(e.target.value)} autoFocus /></div>
          <button type="submit" className="btn btn--primary" disabled={createTerm.isPending}>{t('common.save')}</button>
        </form>
      )}
      {addClass && effectiveTerm && (
        <form className="inline-form glass-inset" onSubmit={submitClass}>
          <div className="field"><label className="label">{t('classes.className')}</label><input className="input glass-inset" value={cls.name} onChange={(e) => setCls({ ...cls, name: e.target.value })} autoFocus /></div>
          <div className="field"><label className="label">{t('classes.classType')}</label><select className="input glass-inset" value={cls.type} onChange={(e) => setCls({ ...cls, type: e.target.value as ClassType })}>{TYPES.map((ty) => <option key={ty} value={ty}>{t(`ctype.${ty}`)}</option>)}</select></div>
          {cls.type === 'custom' && <div className="field"><label className="label">{t('classes.customLabel')}</label><input className="input glass-inset" value={cls.customLabel} onChange={(e) => setCls({ ...cls, customLabel: e.target.value })} /></div>}
          <div className="field"><label className="label">{t('classes.scheduleLabel')}</label><input className="input glass-inset" value={cls.scheduleLabel} onChange={(e) => setCls({ ...cls, scheduleLabel: e.target.value })} /></div>
          <button type="submit" className="btn btn--primary" disabled={createClass.isPending}>{t('common.save')}</button>
        </form>
      )}

      {/* Classes */}
      {!effectiveTerm ? (
        <p className="empty">{t('classes.noTerms')}</p>
      ) : classesQ.isLoading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : !classesQ.data || classesQ.data.length === 0 ? (
        <p className="empty">{t('classes.noClasses')}</p>
      ) : (
        <motion.div className="card-grid" variants={staggerContainer} initial="initial" animate="animate">
          {classesQ.data.map((c) => (
            <motion.button key={c.id} type="button" className="fam-card glass fx-glint" variants={staggerItem} onClick={() => open({ title: c.name, wide: true, dedupeKey: `class:${c.id}`, icon: <GraduationCap size={15} />, node: <ClassDetail classId={c.id} /> })}>
              <h3>{c.name}{c.status === 'archived' && <span className="chip is-muted" style={{ marginInlineStart: '0.5rem' }}>{t('directory.archived')}</span>}</h3>
              <div className="chip-row"><span className="chip">{typeLabel(c.type, c.customLabel)}</span>{c.scheduleLabel && <span className="muted" style={{ fontSize: '0.82rem' }}>{c.scheduleLabel}</span>}</div>
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
