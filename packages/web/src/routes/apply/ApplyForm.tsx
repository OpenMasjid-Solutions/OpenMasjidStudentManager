// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The public admissions enquiry form (CLAUDE.md §4/§14) — anonymous, reached at /apply over the
 *  tunnel. Posts to the plain /apply route (its own zod + honeypot + rate-limit gates); the response
 *  reveals nothing. Includes a hidden honeypot field. Phone-first, on-brand. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../../components/Glyphs';
import { fadeRise } from '../../lib/motion';
import { withBase } from '../../lib/base';

export function ApplyForm() {
  const { t } = useTranslation();
  const [f, setF] = useState({ guardianName: '', guardianPhone: '', guardianEmail: '', childFirstName: '', childLastName: '', childDob: '', programInterest: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.guardianName.trim() || !f.childFirstName.trim() || !f.childLastName.trim()) return;
    setState('sending');
    try {
      const r = await fetch(withBase('/apply'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      setState(r.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate">
        <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-gold)' }}><MasjidMark size={48} /></div>
        <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.4rem' }}>{t('apply.thanksTitle')}</h1>
        <p className="page-sub" style={{ textAlign: 'center' }}>{t('apply.thanksBody')}</p>
      </motion.div>
    );
  }

  return (
    <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate" style={{ maxWidth: '32rem' }}>
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-primary)' }}><MasjidMark size={44} /></div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.4rem' }}>{t('apply.title')}</h1>
      <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.1rem' }}>{t('apply.subtitle')}</p>

      <form onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="ap-gn">{t('apply.guardianName')}</label><input id="ap-gn" className="input glass-inset" value={f.guardianName} onChange={set('guardianName')} required maxLength={120} /></div>
        <div className="field"><label className="label" htmlFor="ap-ph">{t('apply.phone')}</label><input id="ap-ph" className="input glass-inset" value={f.guardianPhone} onChange={set('guardianPhone')} maxLength={40} autoComplete="tel" /></div>
        <div className="field"><label className="label" htmlFor="ap-em">{t('apply.email')}</label><input id="ap-em" type="email" className="input glass-inset" value={f.guardianEmail} onChange={set('guardianEmail')} maxLength={200} autoCapitalize="none" autoComplete="email" /></div>
        <div className="field"><label className="label" htmlFor="ap-cf">{t('apply.childFirst')}</label><input id="ap-cf" className="input glass-inset" value={f.childFirstName} onChange={set('childFirstName')} required maxLength={120} /></div>
        <div className="field"><label className="label" htmlFor="ap-cl">{t('apply.childLast')}</label><input id="ap-cl" className="input glass-inset" value={f.childLastName} onChange={set('childLastName')} required maxLength={120} /></div>
        <div className="field"><label className="label" htmlFor="ap-dob">{t('apply.dob')}</label><input id="ap-dob" type="date" className="input glass-inset" value={f.childDob} onChange={set('childDob')} /></div>
        <div className="field"><label className="label" htmlFor="ap-prog">{t('apply.program')}</label><input id="ap-prog" className="input glass-inset" value={f.programInterest} onChange={set('programInterest')} maxLength={200} placeholder={t('apply.programHint')} /></div>

        {/* Honeypot — hidden from humans; bots that fill it get silently dropped. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
        </div>

        {state === 'error' && <p className="form-error">{t('apply.error')}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={state === 'sending'}>
          {state === 'sending' ? t('auth.working') : t('apply.submit')}
        </button>
      </form>
    </motion.div>
  );
}
