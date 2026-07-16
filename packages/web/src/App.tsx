// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Slice 1 app shell: the login screen in the family "liquid glass" look, plus a
 * working theme flip (dark / light / system) and language switch (en / ar / ur)
 * that flips the whole layout to RTL. No auth yet — real login lands in step 2
 * (CLAUDE.md §12, §20). Every string goes through i18next; colours/spacing come
 * from the ported design tokens (no hardcoded hex).
 */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { SceneBackground } from './components/SceneBackground';
import { MasjidMark } from './components/Glyphs';
import { fadeRise } from './lib/motion';
import { usePrefs, prefsStore } from './lib/prefs';
import { trpc } from './lib/trpc';

const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
  { id: 'ur', label: 'اردو' },
];
const THEMES = ['dark', 'light', 'system'] as const;

export function App() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');

  // Proves the full stack is wired (Vite → server tRPC → SQLite health query).
  const health = trpc.health.useQuery(undefined, { retry: false });

  function cycleTheme() {
    const i = THEMES.indexOf(prefs.theme);
    prefsStore.patch({ theme: THEMES[(i + 1) % THEMES.length] });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    // Auth is wired in the next slice; the form is the shell for now.
    setNotice(t('auth.comingSoon'));
  }

  const statusClass = health.isSuccess ? 'is-ok' : health.isError ? 'is-off' : '';
  const statusText = health.isLoading
    ? t('status.connecting')
    : health.isError
      ? t('status.offline')
      : `${t('status.connected')} · ${health.data?.standalone ? t('status.standalone') : t('status.linked')}`;

  return (
    <>
      <SceneBackground />

      <div className="shell-controls">
        <button type="button" className="btn btn--ghost fx-glint" onClick={cycleTheme} title={t('controls.theme')}>
          {t(`theme.${prefs.theme}`)}
        </button>
        <select
          className="input glass-inset shell-lang"
          value={prefs.language}
          onChange={(e) => prefsStore.patch({ language: e.target.value })}
          aria-label={t('controls.language')}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="auth-wrap">
        <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate">
          <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-primary)' }}>
            <MasjidMark size={48} />
          </div>
          <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.5rem' }}>
            {t('auth.loginTitle')}
          </h1>
          <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            {t('auth.loginSubtitle')}
          </p>

          <form onSubmit={submit}>
            <div className="field">
              <label className="label" htmlFor="username">
                {t('auth.username')}
              </label>
              <input
                id="username"
                className="input glass-inset"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                className="input glass-inset"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {notice && (
              <p className="hint" style={{ textAlign: 'center', marginBlock: '0.25rem 0.75rem' }}>
                {notice}
              </p>
            )}

            <button type="submit" className="btn btn--primary btn--block">
              {t('auth.signIn')}
            </button>
          </form>

          <p className="hint" style={{ textAlign: 'center', marginBlockStart: '1rem' }}>
            <span className={`shell-status ${statusClass}`}>
              <span className="dot" aria-hidden="true" />
              {statusText}
            </span>
          </p>
        </motion.div>
      </div>
    </>
  );
}
