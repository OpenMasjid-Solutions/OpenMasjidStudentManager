// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Password reset (CLAUDE.md §12). Anonymous page at /family/reset with two modes:
 *  - with ?token= (from the reset email): set a new password, then sign in fresh.
 *  - without a token (the "Forgot password?" link): request a reset link by email. The response is
 *    always generic — it never reveals whether an email is registered (§14). */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../components/Glyphs';
import { fadeRise } from '../lib/motion';
import { trpc } from '../lib/trpc';
import { withBase } from '../lib/base';

const MIN_PW = 12;

export function ResetPassword({ token }: { token: string | null }) {
  return token ? <ResetConfirm token={token} /> : <ResetRequest />;
}

function ResetRequest() {
  const { t } = useTranslation();
  const request = trpc.auth.resetRequest.useMutation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await request.mutateAsync({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate">
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-gold)' }}><MasjidMark size={48} /></div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.4rem' }}>{t('auth.resetTitle')}</h1>
      {sent ? (
        <p className="page-sub" style={{ textAlign: 'center', marginBlockStart: '0.5rem' }}>{t('auth.resetSent')}</p>
      ) : (
        <>
          <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>{t('auth.resetRequestSubtitle')}</p>
          <form onSubmit={submit}>
            <div className="field">
              <label className="label" htmlFor="rr-email">{t('auth.resetEmailLabel')}</label>
              <input id="rr-email" type="email" className="input glass-inset" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn btn--primary btn--block" disabled={request.isPending}>{request.isPending ? t('auth.working') : t('auth.resetSendLink')}</button>
          </form>
        </>
      )}
      <p className="hint" style={{ textAlign: 'center', marginBlockStart: '1rem' }}><a href={withBase('/')}>{t('auth.backToLogin')}</a></p>
    </motion.div>
  );
}

function ResetConfirm({ token }: { token: string }) {
  const { t } = useTranslation();
  const info = trpc.auth.resetInfo.useQuery({ token }, { retry: false });
  const confirm = trpc.auth.resetConfirm.useMutation();
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PW) return setError(t('auth.passwordHint'));
    if (password !== confirmPw) return setError(t('family.passwordsDontMatch'));
    try {
      await confirm.mutateAsync({ token, password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const invalid = info.isSuccess && !info.data.valid;

  return (
    <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate">
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-gold)' }}><MasjidMark size={48} /></div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.4rem' }}>{t('auth.resetSetTitle')}</h1>
      {info.isLoading && <p className="page-sub" style={{ textAlign: 'center' }}>{t('status.connecting')}</p>}
      {invalid && (
        <>
          <p className="page-sub" style={{ textAlign: 'center', marginBlockStart: '0.5rem' }}>{t('auth.resetInvalid')}</p>
          <p className="hint" style={{ textAlign: 'center', marginBlockStart: '1rem' }}><a href={withBase('/family/reset')}>{t('auth.resetSendLink')}</a></p>
        </>
      )}
      {done ? (
        <>
          <p className="page-sub" style={{ textAlign: 'center', marginBlockStart: '0.5rem' }}>{t('auth.resetDone')}</p>
          <p className="hint" style={{ textAlign: 'center', marginBlockStart: '1rem' }}><a href={withBase('/')}>{t('auth.backToLogin')}</a></p>
        </>
      ) : info.data?.valid ? (
        <form onSubmit={submit} style={{ marginBlockStart: '1rem' }}>
          <div className="field">
            <label className="label" htmlFor="rc-pw">{t('family.newPassword')}</label>
            <input id="rc-pw" type="password" className="input glass-inset" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <span className="hint">{t('auth.passwordHint')}</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="rc-conf">{t('family.confirmPassword')}</label>
            <input id="rc-conf" type="password" className="input glass-inset" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--block" disabled={confirm.isPending}>{confirm.isPending ? t('auth.working') : t('auth.resetSetButton')}</button>
        </form>
      ) : null}
    </motion.div>
  );
}
