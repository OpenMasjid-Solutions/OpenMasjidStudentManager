// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Forced password change (staff temp password on first login, or after an admin reset).
 *  Blocks the app until done. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../components/Glyphs';
import { fadeRise } from '../lib/motion';
import { trpc } from '../lib/trpc';

const MIN_PW = 12;

export function ChangePassword() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const change = trpc.auth.changePassword.useMutation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < MIN_PW) return setError(t('auth.passwordHint'));
    if (next !== confirm) return setError(t('auth.passwordsMismatch'));
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      await utils.auth.session.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <motion.div className="auth-card glass-raised" variants={fadeRise} initial="initial" animate="animate">
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-primary)' }}>
        <MasjidMark size={48} />
      </div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.4rem' }}>{t('auth.changeTitle')}</h1>
      <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>{t('auth.changeSubtitle')}</p>
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="cp-cur">{t('auth.currentPassword')}</label>
          <input id="cp-cur" type="password" className="input glass-inset" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="cp-new">{t('auth.newPassword')}</label>
          <input id="cp-new" type="password" className="input glass-inset" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <span className="hint">{t('auth.passwordHint')}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="cp-conf">{t('auth.confirmPassword')}</label>
          <input id="cp-conf" type="password" className="input glass-inset" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={change.isPending}>
          {change.isPending ? t('auth.working') : t('auth.changeSubmit')}
        </button>
      </form>
    </motion.div>
  );
}
