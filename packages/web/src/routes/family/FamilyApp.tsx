// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The parent portal shell — phone-first (CLAUDE.md §15), NOT the windowed staff shell. A sticky
 *  top bar (brand + account menu: theme/language/sign-out) over a single scrolling column showing
 *  the family balance, invoices, pay-now, cards, and autopay. Parents work LAN + tunnel. */
import { useTranslation } from 'react-i18next';
import { SceneBackground } from '../../components/SceneBackground';
import { ProfileMenu } from '../../components/ProfileMenu';
import { MasjidMark } from '../../components/Glyphs';
import { trpc } from '../../lib/trpc';
import { FamilyHome } from './Home';

export function FamilyApp() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const onSignedOut = () => void utils.auth.session.invalidate();

  return (
    <div className="family-shell">
      <SceneBackground />
      <header className="family-topbar">
        <span className="brand">
          <span className="mark"><MasjidMark size={22} /></span>
          {t('family.title')}
        </span>
        <span className="spacer" />
        <ProfileMenu onSignedOut={onSignedOut} />
      </header>
      <main className="family-main">
        <div className="fam-hello">
          <h1>{t('family.myFamily')}</h1>
          <p>{t('family.subtitle')}</p>
        </div>
        <FamilyHome />
      </main>
    </div>
  );
}
