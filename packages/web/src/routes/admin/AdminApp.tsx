// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The admin app shell: a topbar + the directory. Nav grows (classes, exams, billing…)
 *  in later slices; slice 3 ships the People directory. Admin-only (LAN, §12.4). */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../../components/Glyphs';
import { ThemeLangControls } from '../../components/ThemeLangControls';
import { trpc } from '../../lib/trpc';
import { Directory } from './Directory';
import { FamilyDetail } from './FamilyDetail';

export function AdminApp() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation();
  const [familyId, setFamilyId] = useState<string | null>(null);

  async function signOut() {
    await logout.mutateAsync();
    await utils.auth.session.invalidate();
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar glass-raised">
        <span className="admin-brand">
          <span className="mark"><MasjidMark size={26} /></span>
          {t('app.name')}
        </span>
        <span className="admin-spacer" />
        <div className="admin-actions">
          <ThemeLangControls />
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut} disabled={logout.isPending}>
            {t('auth.signOut')}
          </button>
        </div>
      </header>
      <main className="admin-main">
        {familyId ? <FamilyDetail familyId={familyId} onBack={() => setFamilyId(null)} /> : <Directory onOpen={setFamilyId} />}
      </main>
    </div>
  );
}
