// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The admin app shell: a topbar with nav + the directory / settings. Nav grows in
 *  later slices; slice 3 shipped People, slice 4 adds student records + settings.
 *  Admin-only (LAN, §12.4). */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MasjidMark } from '../../components/Glyphs';
import { ThemeLangControls } from '../../components/ThemeLangControls';
import { cn } from '../../lib/cn';
import { trpc } from '../../lib/trpc';
import { Directory } from './Directory';
import { FamilyDetail, type StudentLite } from './FamilyDetail';
import { StudentDetail } from './StudentDetail';
import { Settings } from './Settings';

export function AdminApp() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation();
  const [nav, setNav] = useState<'directory' | 'settings'>('directory');
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentLite | null>(null);

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
        <nav className="admin-nav">
          <button type="button" className={cn('btn', 'btn--sm', nav === 'directory' ? 'btn--primary' : 'btn--ghost')} onClick={() => setNav('directory')}>
            {t('nav.directory')}
          </button>
          <button type="button" className={cn('btn', 'btn--sm', nav === 'settings' ? 'btn--primary' : 'btn--ghost')} onClick={() => setNav('settings')}>
            {t('nav.settings')}
          </button>
        </nav>
        <span className="admin-spacer" />
        <div className="admin-actions">
          <ThemeLangControls />
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut} disabled={logout.isPending}>{t('auth.signOut')}</button>
        </div>
      </header>
      <main className="admin-main">
        {nav === 'settings' ? (
          <Settings />
        ) : student ? (
          <StudentDetail student={student} onBack={() => setStudent(null)} />
        ) : familyId ? (
          <FamilyDetail familyId={familyId} onBack={() => setFamilyId(null)} onOpenStudent={setStudent} />
        ) : (
          <Directory onOpen={setFamilyId} />
        )}
      </main>
    </div>
  );
}
