// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
// Ported family design system (order matters), then our app-specific layers.
import './index.css';
import './styles/tokens.css';
import './styles/glass.css';
import './styles/app.css';
import './styles/fonts-arabic.css';
import './styles/shell.css';
import './styles/admin.css';
import './styles/family.css';
import './lib/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { prefsStore } from './lib/prefs';
import { hydrateAppearance } from './lib/appearance';
import { installCursorFx } from './lib/cursorFx';
import { trpc, trpcClient, queryClient } from './lib/trpc';
import { App } from './App';

// Apply saved theme/accent/wallpaper/language before first paint, then adopt any OpenMasjidOS
// appearance hand-off (the #omos fragment on a dashboard "Open") so the app opens on-theme.
prefsStore.hydrate();
hydrateAppearance();
// Pointer-reactive light on glass surfaces (off under reduced-motion / touch).
installCursorFx();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>,
);
