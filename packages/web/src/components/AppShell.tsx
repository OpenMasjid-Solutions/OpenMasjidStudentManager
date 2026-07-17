// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The authenticated desktop shell — brand + clock + profile up top, the active section
 * as the page, floating windows, and the bottom dock. Mirrors OpenMasjidOS AppShell so
 * a masjid admin can't tell they left the platform (§15). Windows + dock require a
 * WindowsProvider ancestor.
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from './Clock';
import { ProfileMenu } from './ProfileMenu';
import { WindowManager } from './WindowManager';
import { SceneBackground } from './SceneBackground';
import { MasjidMark } from './Glyphs';
import { Dock, type Section } from './Dock';

export function AppShell({
  active,
  onNavigate,
  onSignedOut,
  children,
}: {
  active: Section;
  onNavigate: (s: Section) => void;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="app-shell">
      <SceneBackground />
      <div className="topbar">
        <span className="admin-brand">
          <span className="mark"><MasjidMark size={24} /></span>
          {t('app.name')}
        </span>
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Clock />
          <ProfileMenu onSignedOut={onSignedOut} />
        </div>
      </div>
      <main className="app-main">{children}</main>
      <WindowManager />
      <Dock active={active} onNavigate={onNavigate} />
    </div>
  );
}
