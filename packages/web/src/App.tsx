// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The auth gate. Reads `auth.session` and routes to first-run setup, login, or the
 * signed-in home. The origin policy (admin = LAN only) is enforced server-side; the
 * UI just reflects it (setup blocked over the tunnel; admin cookie inert over tunnel).
 * Per-role dashboards land in later slices (CLAUDE.md §20).
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { SceneBackground } from './components/SceneBackground';
import { ShellControls } from './components/ShellControls';
import { MasjidMark } from './components/Glyphs';
import { fadeRise } from './lib/motion';
import { Setup } from './routes/Setup';
import { Login } from './routes/Login';
import { Home } from './routes/Home';
import { trpc } from './lib/trpc';

function SetupOnLanNotice() {
  const { t } = useTranslation();
  return (
    <motion.div className="auth-card glass-raised" variants={fadeRise} initial="initial" animate="animate">
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-gold)' }}>
        <MasjidMark size={48} />
      </div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.4rem' }}>{t('auth.setupOnLanTitle')}</h1>
      <p className="page-sub" style={{ textAlign: 'center' }}>{t('auth.setupOnLanBody')}</p>
    </motion.div>
  );
}

export function App() {
  const { t } = useTranslation();
  const session = trpc.auth.session.useQuery(undefined, { retry: false });
  const health = trpc.health.useQuery(undefined, { retry: false });
  const s = session.data;

  let screen: React.ReactNode;
  if (session.isLoading) {
    screen = (
      <div className="auth-card glass-raised" style={{ textAlign: 'center' }}>
        <p className="page-sub">{t('status.connecting')}</p>
      </div>
    );
  } else if (session.isError || !s) {
    screen = <Login />;
  } else if (s.authenticated && s.user) {
    screen = <Home user={s.user} />;
  } else if (s.setupRequired) {
    screen = s.origin === 'tunnel' ? <SetupOnLanNotice /> : <Setup />;
  } else {
    screen = <Login tunnel={s.origin === 'tunnel'} />;
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
      <ShellControls />
      <div className="auth-wrap">
        {screen}
        <p className="hint" style={{ textAlign: 'center', marginBlockStart: '1rem' }}>
          <span className={`shell-status ${statusClass}`}>
            <span className="dot" aria-hidden="true" />
            {statusText}
          </span>
        </p>
      </div>
    </>
  );
}
