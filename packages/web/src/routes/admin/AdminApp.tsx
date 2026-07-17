// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The admin app on the family shell: top bar (brand + clock + profile), a bottom dock
 *  for nav, and mac-style windows for records (§15 — continuity with OpenMasjidOS/Kiosk).
 *  Admin-only (LAN, §12.4). */
import { useState } from 'react';
import { WindowsProvider } from '../../components/Windows';
import { AppShell } from '../../components/AppShell';
import { type Section } from '../../components/Dock';
import { trpc } from '../../lib/trpc';
import { Dashboard } from './Dashboard';
import { Directory } from './Directory';
import { Classes } from './Classes';
import { Staff } from './Staff';
import { Settings } from './Settings';

export function AdminApp() {
  const utils = trpc.useUtils();
  const [section, setSection] = useState<Section>('dashboard');
  const onSignedOut = () => void utils.auth.session.invalidate();

  return (
    <WindowsProvider>
      <AppShell active={section} onNavigate={setSection} onSignedOut={onSignedOut}>
        {section === 'dashboard' ? (
          <Dashboard onNavigate={setSection} />
        ) : section === 'directory' ? (
          <Directory />
        ) : section === 'classes' ? (
          <Classes />
        ) : section === 'staff' ? (
          <Staff />
        ) : (
          <Settings />
        )}
      </AppShell>
    </WindowsProvider>
  );
}
