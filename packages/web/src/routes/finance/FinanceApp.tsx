// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** The finance app on the family shell (§15): a bottom dock (Billing) + mac-style windows for
 *  each family's billing. Finance works on the LAN and over the Cloudflare tunnel (§5); every
 *  read/write is admin+finance-scoped server-side. */
import { WindowsProvider } from '../../components/Windows';
import { AppShell } from '../../components/AppShell';
import { FINANCE_ITEMS } from '../../components/Dock';
import { trpc } from '../../lib/trpc';
import { Billing } from '../admin/Billing';

export function FinanceApp() {
  const utils = trpc.useUtils();
  const onSignedOut = () => void utils.auth.session.invalidate();
  return (
    <WindowsProvider>
      <AppShell items={FINANCE_ITEMS} active="billing" onNavigate={() => {}} onSignedOut={onSignedOut}>
        <Billing />
      </AppShell>
    </WindowsProvider>
  );
}
