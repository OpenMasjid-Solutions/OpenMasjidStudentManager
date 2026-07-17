// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
// Ported verbatim from OpenMasjidOS packages/ui/src/components/ErrorBoundary.tsx @ c4d309f (v0.40.0) — keep structurally identical for re-sync (CLAUDE.md §15). See packages/web/PORTED_FROM_OPENMASJIDOS.md
/**
 * Minimal error boundary. Used to wrap window content (terminals, logs, file
 * viewers) so a failure in one window — including a failed lazy-chunk load —
 * shows a tidy message instead of taking down the whole dashboard.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <div className="hint" style={{ padding: '1rem' }}>Something went wrong here. Try closing and reopening this window.</div>
        )
      );
    }
    return this.props.children;
  }
}
