// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Authenticated placeholder. The per-role dashboards (admin/teach/billing/family)
 *  arrive in later slices; for now this confirms the session + offers sign-out. */
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../components/Glyphs';
import { fadeRise } from '../lib/motion';
import { trpc } from '../lib/trpc';

interface SessionUser {
  role: 'admin' | 'teacher' | 'finance' | 'parent';
  username?: string;
  source: 'local' | 'sso';
}

export function Home({ user }: { user: SessionUser }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation();

  async function signOut() {
    await logout.mutateAsync();
    await utils.auth.session.invalidate();
  }

  return (
    <motion.div className="auth-card glass-raised fx-glint" variants={fadeRise} initial="initial" animate="animate">
      <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-primary)' }}>
        <MasjidMark size={48} />
      </div>
      <h1 className="page-title" style={{ textAlign: 'center', fontSize: '1.5rem' }}>{t('home.title')}</h1>
      <p className="page-sub" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        {t('home.signedInAs', { name: user.username ?? t(`role.${user.role}`) })}
      </p>
      <p className="hint" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        {t('home.role', { role: t(`role.${user.role}`) })}
      </p>

      <p className="page-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>{t('home.next')}</p>

      <button type="button" className="btn btn--ghost btn--block" onClick={signOut} disabled={logout.isPending}>
        {logout.isPending ? t('auth.working') : t('auth.signOut')}
      </button>
    </motion.div>
  );
}
