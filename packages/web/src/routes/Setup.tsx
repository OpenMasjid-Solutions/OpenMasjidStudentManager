// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** First-run: create the admin account (LAN only — see App gate). */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../components/Glyphs';
import { fadeRise } from '../lib/motion';
import { trpc } from '../lib/trpc';

const MIN_PW = 12;
const STRENGTH_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e'];
const STRENGTH_KEYS = ['auth.pwWeak', 'auth.pwFair', 'auth.pwGood', 'auth.pwStrong'];

function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= MIN_PW) s += 1;
  if (pw.length >= 16) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s += 1;
  return Math.min(s, 4);
}

export function Setup() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const setup = trpc.auth.setup.useMutation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const pwScore = passwordScore(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PW) return setError(t('auth.passwordHint'));
    if (password !== confirm) return setError(t('auth.passwordsMismatch'));
    try {
      await setup.mutateAsync({ username, password });
      await utils.auth.session.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate">
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-primary)' }}>
        <MasjidMark size={48} />
      </div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.5rem' }}>{t('auth.setupTitle')}</h1>
      <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>{t('auth.setupSubtitle')}</p>

      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="su-username">{t('auth.username')}</label>
          <input id="su-username" className="input glass-inset" autoComplete="username" value={username}
            onChange={(e) => setUsername(e.target.value)} required />
        </div>

        <div className="field">
          <label className="label" htmlFor="su-password">{t('auth.password')}</label>
          <input id="su-password" type="password" className="input glass-inset" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
          {password.length > 0 && (
            <div style={{ display: 'flex', gap: '0.25rem', marginBlockStart: '0.45rem' }} aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{ flex: 1, height: '4px', borderRadius: '2px',
                  background: i < pwScore ? STRENGTH_COLORS[pwScore - 1] : 'var(--glass-border)',
                  transition: 'background var(--dur-micro) ease' }} />
              ))}
            </div>
          )}
          <span className="hint">{password.length > 0 && pwScore > 0 ? t(STRENGTH_KEYS[pwScore - 1]) : t('auth.passwordHint')}</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="su-confirm">{t('auth.confirmPassword')}</label>
          <input id="su-confirm" type="password" className="input glass-inset" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required />
        </div>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="btn btn--primary btn--block" disabled={setup.isPending}>
          {setup.isPending ? t('auth.working') : t('auth.createAccount')}
        </button>
      </form>
    </motion.div>
  );
}
