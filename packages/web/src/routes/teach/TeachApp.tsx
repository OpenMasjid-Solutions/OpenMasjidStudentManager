// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The teacher app on the same family shell as admin (§15) — a bottom dock (My Week / My
 *  Classes) and mac-style windows for class detail. Teacher works on LAN and over the
 *  Cloudflare tunnel (§5); every read is scoped to the caller server-side. */
import { useState } from 'react';
import { WindowsProvider } from '../../components/Windows';
import { AppShell } from '../../components/AppShell';
import { TEACH_ITEMS } from '../../components/Dock';
import { trpc } from '../../lib/trpc';
import { MyWeek } from './MyWeek';
import { MyClasses } from './MyClasses';

export function TeachApp() {
  const utils = trpc.useUtils();
  const [section, setSection] = useState('week');
  const onSignedOut = () => void utils.auth.session.invalidate();

  return (
    <WindowsProvider>
      <AppShell items={TEACH_ITEMS} active={section} onNavigate={setSection} onSignedOut={onSignedOut}>
        {section === 'classes' ? <MyClasses /> : <MyWeek />}
      </AppShell>
    </WindowsProvider>
  );
}
